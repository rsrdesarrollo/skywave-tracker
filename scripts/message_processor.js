var MongoClient = require('mongodb').MongoClient;
var async = require('async');
var _ = require('underscore');

var RUN_PERIOD_SEC = 60;
var res = {};

function handleErrors(err){	
	if (err) {
		if(res && res.db) res.db.close();
		console.log("ERROR:", err, "finish application.");
		throw err;
	}
}

async.parallel([
	function(callback){ // Loading mongo connection
		MongoClient.connect('mongodb://localhost:27017/skywave', function(err, db) {	
			callback(err, db);
		});
	}
], function (err, result) {
	handleErrors(err);
	
	res = {
		db : result[0]
	};
	
	async.forever(
		main,
		handleErrors
	);
});

// Main loop - for developing module
function main(nextRun){
	res.db.collection('from_mobile_msg').find({Processed: false}).limit(100).toArray(function(err, results){
		handleErrors(err);
		
		console.log("Processing", results.length, "messages.");
		var raw_messages = 0;
		
		for(var i = 0, len = results.length; i < len; i++){
			if(!results[i].Payload){
				raw_messages ++;
				
				var cache = results[i];
				
				res.db.collection('from_mobile_msg_raw').save(cache, function(err){
					handleErrors(err);
					res.db.collection('from_mobile_msg').remove(cache, handleErrors);
				});
			}else{
				// TODO: Abstraction of name fields 
				results[i].Payload.Fields.Speed /= 10.0;
				results[i].Payload.Fields.Course /= 10.0;
				results[i].Payload.Fields.GpsFixTime = new Date(results[i].Payload.Fields.GpsFixTime * 60000);
				results[i].Payload.Fields.Latitude /= 60000.0;
				results[i].Payload.Fields.Longitude /= 60000.0;
				results[i].Processed = true;
				
				res.db.collection('from_mobile_msg').save(results[i], handleErrors);
			}
		}
		
		console.log('Raw messages moved:', raw_messages, ', Messages processed: ', results.length - raw_messages);
		console.log("Next run in", RUN_PERIOD_SEC , "seconds");
		setTimeout(async.apply(nextRun, err), RUN_PERIOD_SEC * 1000);
	});
}