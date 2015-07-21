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
    endpoints : {
        auth : "http://api.local.comiccloud.io/v0.1/oauth/access_token",
        images : "http://api.local.comiccloud.io/v0.1/images",
        cba : "http://api.local.comiccloud.io/v0.1/comicbookarchives",
        s3_base : "https://s3.amazonaws.com"
    },
    param: {
        grant_type : "client_credentials",//TODO: Move to environment variables
        client_id : "test_processor_id",
        client_secret : "test_processor_secret",
        scope: "processor"
    },
    access_token : null
};

exports.handler = function(event, context) {

    console.log( "Running index.handler" );

    var user_upload_bucket = process.env.AWS_S3_Uploads;//event.bucket_name;//TODO:Change this back before posting!
    var user_upload_key = event.file_name;
    var cba_id = event.cba_id;

    async.waterfall([
        function(callback) {//1 - Authorise
            console.log("Authenticating Client".green);

            request.post(settings.endpoints.auth , {form: settings.param}, function (error, response, body) {//TODO: This should eventually be a JSON raw body not a form
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

            async.forEachOf(zip.files, function (file, filename, callback) {
                console.log("Processing file: ".green + filename.blue);
                if(file.dir === true){
                    console.log('Directory found.');
                    return callback();
                }

                var fileExt = path.extname(filename).split('.').join('');
                var acceptedExtensions = ['jpg', 'jpeg'];

                if(!acceptedExtensions.hasObject(fileExt)){
                    console.log('Unaccepted File type \'' + fileExt + '\' found.');
                    return callback();
                }

                var fileType = getFileType(file.asNodeBuffer());
                var basename = path.basename(filename, path.extname(filename));
                var fileSize = 1;//TODO: File size check.

                var user_images_uploads = process.env.AWS_S3_Images;
                var user_images_uploads_key_without_ext = uuid.v4();
                var user_images_uploads_key = user_images_uploads_key_without_ext + "." + fileExt;
                var user_images_uploads_body = file.asNodeBuffer();

                var fileHash = crypto.createHash('md5').update(user_images_uploads_body).digest('hex');
                var image_exists = false;

                var image_id = "";

                async.waterfall([
                    function(callback){//Check if image exists
                        request.get(settings.endpoints.images + "?image_hash=" + fileHash, { headers : {'Authorization' : settings.access_token}}, function (error, response, body) {
                            if (error) {
                                console.log("Error getting object " + user_upload_key + " from bucket " + user_upload_bucket +
                                ".\nMake sure they exist and your bucket is in the same region as this function.".red);
                                context.fail("Error getting file: " + JSON.stringify(err).red);
                            }else {
                                callback(null, JSON.parse(body))
                            }
                        });

                    },
                    function(response, callback){
                        if(response.total == 0){//Post Image to Storage

                            console.log("Image Match Not Found".green);

                            var params = {
                                Bucket: user_images_uploads,
                                Key: user_images_uploads_key,
                                Body: user_images_uploads_body,
                                ACL: 'public-read' //TODO: Change to 'authenticated-read' on production. Also maybe extract to variable
                            };

                            s3.putObject(params, function(err, data) {
                                if (err) {
                                    console.log(("Error putting object " + user_images_uploads_key + " into bucket " + user_images_uploads +
                                    ".\nMake sure they exist and your bucket is in the same region as this function.").red);
                                    context.fail(("Error getting file: " + JSON.stringify(err)).red);
                                } else {
                                    console.log("Image successfully uploaded".green);

                                    var upload_url = settings.endpoints.s3_base + "/"+ user_images_uploads + "/" +user_images_uploads_key; //TODO: This ideally needs to something returned from S3's upload
                                    var new_image_request = {
                                        "image_slug" : user_images_uploads_key_without_ext,
                                        "image_hash" : fileHash,
                                        "image_url" : upload_url,
                                        "image_size" : 1,
                                        "related_comic_book_archive_id" : cba_id
                                    };
                                    request.post(settings.endpoints.images , {body : new_image_request, json : true, headers : {'Authorization' : settings.access_token}}, function (error, response, body) {//TODO: This should eventually be a JSON raw body not a form
                                        console.log(error);
                                        console.log(body);
                                        callback();
                                    });

                                }

                            });

                        }else{
                            console.log('Image Match Found'.blue);
                            console.log(response.images[0].id);
                            /*request.put(settings.endpoints.cba , {body : { "attach_image_id" : ""}, json : true, headers : {'Authorization' : settings.access_token}}, function (error, response, body) {//TODO: This should eventually be a JSON raw body not a form
                                console.log(error);
                                console.log(body);
                                callback();
                            });*/
                            callback();
                        }


                    }
                ], function(err, result){
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
