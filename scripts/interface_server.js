var soap = require('soap');
var MongoClient = require('mongodb').MongoClient;
var async = require('async');
var _ = require('underscore');

var url = __dirname + '/wsdl/Messages.svc.xml';

var PAGE_SIZE = 20;
var RUN_PERIOD_SEC = 60;

var res = {}; // Global resources

function handleErrors(err){	
	if (err) {
		if(res && res.db) res.db.close();
		console.log("ERROR:", err, "finish application.");
		throw err;
	}
}

function mapSkywaveMessage(message){
	message._id = message.ID;
	message.ReceiveUTC = new Date(message.ReceiveUTC);
	message.Processed = false;
	
	if(message.Payload){
		message.Payload.ReportType = message.Payload.attributes.Name;
		message.Payload.SIN = message.Payload.attributes.SIN;
		message.Payload.MIN = message.Payload.attributes.MIN;
		
		message.Payload.Fields = _.reduce(
			message.Payload.Fields.Field,
			function(memo, field) {
				// If looks like a number, is a number.			
				if(field.attributes.Value.match(/^[-+]?\d+$/))
					memo[field.attributes.Name] = parseInt(field.attributes.Value);
				else
					memo[field.attributes.Name] = field.attributes.Value;
				
				return memo;
			},
			{}
		);
				
		delete message['Payload']['attributes'];
		delete message['Payload']['Fields']['Field'];
	}
	
	delete message['ID'];
	delete message['MessageUTC'];
	
	return message;
}

// Loading App resources in parallel.
async.parallel([
	function(callback){ // Loading mongo connection
		MongoClient.connect('mongodb://localhost:27017/skywave', function(err, db) {	
			callback(err, db);
		});
	},
	function(callback){ // Loading soap client
		soap.createClient(url, function(err, client) {	
			callback(err, client);
		});
	}

], function (err, result) {
	handleErrors(err);
	
	res = {
		db : result[0],
		client : result[1]
	};
	
	async.forever(
		main,
		handleErrors
	);
});

function main(nextRun){
	
	res.db.collection('accounts').find({active : true}).toArray(function(err, accounts) {
		handleErrors(err);
		
		console.log("Processing",accounts.length, "accounts.");
		
		for(var i = 0, len = accounts.length; i < len; i++){
			processAccount(accounts[i]);
		}
		
		console.log("Next run in", RUN_PERIOD_SEC , "seconds");
		setTimeout(async.apply(nextRun, err), RUN_PERIOD_SEC * 1000);
	});
	
}

function processAccount(account){
	console.log("Processing account:", account.accessID);
	
	updateAllSubAccountsFromAccount(account);
	updateAllMobilesFromAccount(account);
	downloadNewMessagesFromAccount(account);
	
	if(account.subaccounts && account.subaccounts.length > 0){
		console.log('Proccessing subaccounts for', account.accessID);
		downloadNewMessagesFromSubaccountsOf(account);
	}
}

function updateAllSubAccountsFromAccount(account){
	
	request = _.pick(account, ['accessID', 'password']);
	
	res.client.GetSubaccountInfos(request, function(err, result){
		handleErrors(err);
		if(result.GetSubaccountInfosResult.ErrorID != 0){
			console.log('ERROR[GetSubaccountInfos]: Skywave code:',result.GetSubaccountInfosResult.ErrorID, ',account:',account.accessID);
			return;
		}
		
		var subaccounts = result.GetSubaccountInfosResult.Subaccounts.SubaccountInfo;
		
		console.log('Account',account.accessID, 'has', subaccounts.length, 'subaccounts.');
		
		account.subaccounts = subaccounts;
		res.db.collection('accounts').save(account, handleErrors);
		
	});
}

function updateAllMobilesFromAccount(account){

	var lastRequestLength = 0;
	
	var request = _.pick(account, ['accessID', 'password']);
	
	async.doWhilst(
		function(callback){
			request.pageSize = PAGE_SIZE;
			
			res.client.GetMobilesPaged(request, function(err, result) {
				handleErrors(err);
				
				if(result.GetMobilesPagedResult.ErrorID != 0){
					console.log('ERROR[GetMobilesPaged]: Skywave code:',result.GetMobilesPagedResult.ErrorID, ',account:',account.accessID);
					return;
				}
				
				var mobiles = result.GetMobilesPagedResult.Mobiles.MobileExInfo
				
				if (!mobiles) mobiles = [];
				
				console.log('Readed', mobiles.length, 'mobile devices from server account',account.accessID);
				
				mobiles = _.map(
					mobiles,
					function (mobile){
						mobile._id = mobile.ID;
						mobile.ID = undefined;
						mobile.LastRegistrationUTC = new Date(mobile.LastRegistrationUTC);
						mobile.AccountID = account._id
						return mobile;
					}
				);
				
				async.each(
					mobiles,
					function(mobile, callback){
						res.db.collection('mobiles').save(mobile,{},callback);
					},
					handleErrors
				);
				
				lastRequestLength = mobiles.length
				if (mobiles.length > 0)
					request.sinceMobile = mobiles.pop().ID;
				
				// Run next batch
				callback();
			});
		},
		function () { return lastRequestLength >= PAGE_SIZE && lastRequestLength > 0 },
		handleErrors
	);

}

function downloadNewMessagesFromAccount(account){
	if(! account.filter){
		var dateFilter = new Date();
		dateFilter.setDate(dateFilter.getDate() - 10); // 10 days ago
		dateFilter = dateFilter.toISOString();
		dateFilter = dateFilter.replace('T', ' ');
		dateFilter = dateFilter.replace(/.\d+Z/i, '');
		
		console.log("INFO: Account without filter. Setting date:", dateFilter);
		
		account.filter = {
			IncludeRawPayload : true,
			StartUTC: dateFilter
		}
	}
	
	var request = _.pick(account, ['accessID', 'password', 'filter']);
	
	res.client.GetReturnMessages(request, function(err, result){
		handleErrors(err);
		
		// if no new messages, just leave.
		if (!result.GetReturnMessagesResult.Messages)
			return;
		
		var messages = result.GetReturnMessagesResult.Messages.ReturnMessage;
		
		console.log("Readed", messages.length, "messages from account:",account.accessID);
		
		messages = _.map(messages,mapSkywaveMessage);
		
		res.db.collection('from_mobile_msg').insert(messages, function(err){
			if(err) console.log("ERROR: inserting from mobile messages:", err);
		})
		
		account.filter.StartUTC = result.GetReturnMessagesResult.NextStartUTC;
		res.db.collection('accounts').save(account, handleErrors);
	});
}

function downloadNewMessagesFromSubaccountsOf(account){
	
	var request = _.pick(account, ['accessID', 'password', 'filter']);
	var nextTimesUtc = [];
		
	async.each(
		account.subaccounts,
		function(subaccount, done){
			request.filter.SubAccountID = subaccount.AccountID;
			
			res.client.GetReturnMessages(request, function(err, result){
				handleErrors(err);
				
				// if no new messages, just leave.
				if (!result.GetReturnMessagesResult.Messages){
					done(err);
					return;
				}
				
				var messages = result.GetReturnMessagesResult.Messages.ReturnMessage;
				
				console.log(
					"Readed", messages.length, "messages from account:",account.accessID, 
					',sub:', subaccount.AccountID
				);
				
				messages = _.map(messages,mapSkywaveMessage);
				
				res.db.collection('from_mobile_msg').insert(messages, function(err){
					if(err) console.log("ERROR: inserting from mobile messages:", err);
				})
				
				// We need a numeric value of Date to apply _.max latter
				var date = new Date(result.GetReturnMessagesResult.NextStartUTC);
				
				nextTimesUtc.push({
					filter: result.GetReturnMessagesResult.NextStartUTC,
					valueOf : date.valueOf()
				});
				
				done(err);
			});
		},
		function(err){
			handleErrors(err);
			
			if(nextTimesUtc.length <1) // No new messages, Skip next UTC update
				return;
			
			var max = _.max(nextTimesUtc, function(a){return a.valueOf;} );
			
			account.filter.StartUTC = max.filter;
			res.db.collection('accounts').save(account, handleErrors);			
		}
	);
	

	
}