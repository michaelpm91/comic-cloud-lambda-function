/**
 * Created by Michael on 16/07/15.
 */
console.log('Loading function');
var colors = require('colors');
var request = require('request');
var async = require('async');
var aws = require('aws-sdk');
var s3 = new aws.S3();//{apiVersion: '2006-03-01'});
var JSZip = require("jszip");

var settings = {
    auth_endpoint : "http://api.local.comiccloud.io/v0.1/oauth/access_token",
    param: {
        grant_type : "client_credentials",
        client_id : "test_processor_id",
        client_secret : "test_processor_secret",
        scope: "processor"
    },
    access_token : null
}
exports.handler = function(event, context) {

    console.log( "Running index.handler" );

    var user_upload_bucket = event.bucket_name;
    var user_upload_key = event.file_name;
    var cba_id = event.cba_id;

    async.waterfall([
        function(callback) {//first - Download Zip

            console.log("We made it".green);
            s3.getObject({Bucket: user_upload_bucket, Key: user_upload_key}, function(err, data) {//Retrieve Upload
                if (err) {
                    console.log("Error getting object " + user_upload_key + " from bucket " + user_upload_bucket +
                    ".\nMake sure they exist and your bucket is in the same region as this function.".red);
                    context.fail("Error getting file: " + JSON.stringify(err).red);
                } else {
                    callback();
                }
            });
        },
        function(callback){

        },
        function(callback) {//# - Authorise

            request.post(settings.auth_endpoint, {form: settings.param}, function (error, response, body) {
                body = JSON.parse(body);
                if (!error && response.statusCode == 200) {
                    settings.access_token = body.access_token;
                    callback();
                }else{
                    context.fail(("Auth Request Error: " + JSON.parse(error)).red);
                }
            });

        },

    ],
    function(err, results){
        context.succeed('Comic Book Archive successfully processed.'.green);

    });

};