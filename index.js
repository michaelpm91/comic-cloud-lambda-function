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
var path = require("path");
var getFileType = require('file-type');
var crypto = require('crypto');
var uuid = require('uuid');
var fs = require('fs');

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

    var user_upload_bucket = process.env.AWS_S3_Uploads;//event.bucket_name;//TODO:Change this back before posting!
    var user_upload_key = event.file_name;
    var cba_id = event.cba_id;

    async.waterfall([
        function(callback) {//1 - Authorise
            console.log("Authenticating Client".green);

            request.post(settings.auth_endpoint, {form: settings.param}, function (error, response, body) {//TODO: This should eventually be a JSON raw body not a form
                body = JSON.parse(body);
                if (!error && response.statusCode == 200) {
                    settings.access_token = body.access_token;
                    console.log("Client successfully authenticated".green)
                    callback();
                }else{
                    context.fail(("Client authentication failed: " + JSON.parse(error)).red);
                }
            });
        },
        function(callback) {//2 - Download Archive
            console.log("Retrieving file".green);
            s3.getObject({Bucket: user_upload_bucket, Key: user_upload_key}, function(err, data) {//Retrieve Upload
                if (err) {
                    console.log("Error getting object " + user_upload_key + " from bucket " + user_upload_bucket +
                    ".\nMake sure they exist and your bucket is in the same region as this function.".red);
                    context.fail("Error getting file: " + JSON.stringify(err).red);
                } else {
                    console.log('File successfully retrieved.');
                    callback(null, data);
                }
            });
        },
        function(filestream, callback){//3 - Process Archive
            console.log('Processing Comic Book Archive'.green);

            var zip = new JSZip(filestream.Body);//Load archive into JSZip

            var pages = [];

            //fs.writeFile("zip.json", JSON.stringify(zip));
            async.forEachOf(zip.files, function (file, filename, callback) {
                console.log(JSON.stringify(file._data));
                console.log("Processing file: ".green + filename.blue);
                //if(filename.substr(-1) === "/" ){
                if(file.dir === true){
                    console.log('Directory found.');
                    return callback();
                }
                //fs.writeFile(filename+"_log.json", JSON.stringify(file));

                var fileExt = path.extname(filename).split('.').join('');

                var acceptedExtensions = ['jpg', 'jpeg'];

                if(!acceptedExtensions.hasObject(fileExt)){
                    console.log('Unaccepted File type \'' + fileExt + '\' found.');
                    return callback();
                }
                var fileType = getFileType(file.asNodeBuffer());
                var basename = path.basename(filename, path.extname(filename));
                var fileSize = file._data.uncompressedSize;//TODO: File size check.
                console.log(fileSize);

                var user_images_uploads = 'comicclouddevelopimages';
                var user_images_uploads_key_without_ext = uuid.v4();
                var user_images_uploads_key = user_images_uploads_key_without_ext + "." + fileExt;
                var user_images_uploads_body = file.asNodeBuffer();

                var fileHash = crypto.createHash('md5').update(user_images_uploads_body).digest('hex');
                var image_exists = false;

                var image_id = "";

                async.waterfall([
                    function(callback){
                        // do some stuff ...
                    }
                ], function(err, result){
                    //pages[basename] = user_images_uploads_key_without_ext;
                    callback();
                });
            }, function(err){
                callback(null, pages);

            });
        }
    ],
    function(err, results){
        context.succeed('Comic Book Archive successfully processed.'.green);

    });

};

Array.prototype.hasObject = (
    !Array.indexOf ? function (o)
    {
        var l = this.length + 1;
        while (l -= 1)
        {
            if (this[l - 1] === o)
            {
                return true;
            }
        }
        return false;
    } : function (o)
    {
        return (this.indexOf(o) !== -1);
    }
);
Array.prototype.toObject = function(){
    var arr = this;
    var rv = {};
    for (var i = 0; i < arr.length; ++i)
        rv[i] = arr[i];
    return rv;
};
