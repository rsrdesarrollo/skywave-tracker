var express = require('express');
var geojson = require('geojson');
var _ = require('underscore');

var router = express.Router();

/**
* Get track points for mobile.
*/
router.get('/:mobile([0-9]+SKY[0-9A-F]+)/Point/:part', function(req, res, next) {
  var mobile = req.params.mobile;
  
  req.r.db.collection('from_mobile_msg').find(
    {MobileID : mobile, SIN : 128},
    {sort : "-Payload.Fields.GPSFixTime"}
  ).toArray(function(err, reports){
	
    if(err) throw err;
	
    reports = _.map(reports, function(report){
      return _.extend({
        ID : report._id,
        ReceivedUTC : report.ReceivedUTC,
        SIN : report.SIN,
        ReportType : report.Payload.ReportType,
        MobileID : report.MobileID,
      },
        report.Payload.Fields
      );
    });
    reports = geojson.parse(reports, {Point: ['Latitude', 'Longitude']});
    res.send(reports);
  });
});

/**
* Get track line for mobile.
**/
router.get('/:mobile([0-9]+SKY[0-9A-F]+)/Line/:part', function(req, res, next) {
  var mobile = req.params.mobile;
  
  req.r.db.collection('from_mobile_msg').find(
    {MobileID : mobile, SIN : 128},
	{_id:0, "Payload.Fields.Latitude":1, "Payload.Fields.Longitude":1},
    {sort : "-Payload.Fields.GPSFixTime"}
  ).toArray(function(err, reports){
	
    if(err) throw err;
	
    reports = _.map(reports, function(report){
      return [report.Payload.Fields.Longitude, report.Payload.Fields.Latitude];
    });
	
    reports = geojson.parse([{line : reports}], {LineString: 'line'});
    res.send(reports);
  });
});

module.exports = router;
