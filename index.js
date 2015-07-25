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
require('pro-array');
var http = require('http');

exports.handler = function(event, context) {

    console.log( "Running index.handler" );

    var settings = {
        endpoints : {
            auth :  event.api_version + "/oauth/access_token",
            images : event.api_version + "/images",
            cba : event.api_version + "/comicbookarchives",
            s3_base : process.env.S3_BASE_URL
        },
        param: {
            grant_type : process.env[event.environment + '_GRANT_TYPE'],
            client_id : process.env[event.environment + '_CLIENT_ID'],
            client_secret : process.env[event.environment + '_CLIENT_SECRET'],
            scope: process.env[event.environment + '_API_SCOPE']
        },
        access_token : null
    };

   var cba_id = event.cba_id;

    async.waterfall([
        function(callback) {//1 - Authorise
            console.log("Authenticating Client".green);

            request.post(settings.endpoints.auth , {form: settings.param}, function (error, response, body) {//TODO: This should eventually be a JSON raw body not a form
                body = JSON.parse(body);
                if (!error && response.statusCode == 200) {
                    settings.access_token = body.access_token;
                    console.log("Client successfully authenticated".green);
                    callback();
                }else{
                    context.fail(("Client authentication failed: " + JSON.parse(error)).red);
                }
            });
        },
        function(callback){
            console.log("Checking Comic Book Archive Status".green);

            request.get(settings.endpoints.cba + "/" + cba_id  ,{ headers : {'Authorization' : settings.access_token}}, function (error, response, body) {//TODO: This should eventually be a JSON raw body not a form
                body = JSON.parse(body);
                if (!error && response.statusCode == 200) {
                    cba_status = body.comic_book_archive[0].comic_book_archive_status;
                    if(cba_status == 1){
                        callback({error : "Comic Book Archive Already Successfully Processed"});
                    }
                    callback();
                }else if(response.statusCode == 404){
                    callback({error : "Comic Book Archive Not Found"});
                }
            });
        },
        function(callback) {//2 - Download Archive
            console.log("Retrieving file".green);
            request.get(event.fileLocation, {encoding: null}, function(error, response, body) {
                if (!error && response.statusCode == 200) {
                    console.log('File successfully retrieved.');
                    callback(null, body);
                }else{
                    context.fail("Error getting file: " + JSON.stringify(error).red);
                }
            });
        },
        function(filestream, callback){//3 - Process Archive
            console.log('Processing Comic Book Archive'.green);

            var zip = new JSZip(filestream);//Load archive into JSZip

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
                var fileSize = file.asNodeBuffer().length;

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
                                callback({error : "Error getting file: " + JSON.stringify(error)});
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
                                Key: user_images_uploads_key, //TODO: Consider changing key of upload to be more secure
                                Body: user_images_uploads_body,
                                ACL: 'public-read' //TODO: Change to 'authenticated-read' on production. Also maybe extract to variable
                            };

                            s3.putObject(params, function(err, data) {
                                if (err) {
                                    console.log(("Error putting object " + user_images_uploads_key + " into bucket " + user_images_uploads +
                                    ".\nMake sure they exist and your bucket is in the same region as this function.").red);
                                    //context.fail(("Error getting file: " + JSON.stringify(err)).red);
                                    callback({error : "Error getting file: " + JSON.stringify(err)});
                                } else {
                                    console.log("Image successfully uploaded".green);
                                    var upload_url = settings.endpoints.s3_base + "/"+ user_images_uploads + "/" +user_images_uploads_key; //TODO: This ideally needs to something returned from S3's upload
                                    var new_image_request = {
                                        "image_slug" : user_images_uploads_key_without_ext,
                                        "image_hash" : fileHash,
                                        "image_url" : upload_url,
                                        "image_size" : fileSize,
                                        "related_comic_book_archive_id" : cba_id
                                    };
                                    request.post(settings.endpoints.images , {body : new_image_request, json : true, headers : {'Authorization' : settings.access_token}}, function (error, response, body) {//TODO: This should eventually be a JSON raw body not a form
                                        if (!error && response.statusCode == 201) {
                                            //body = JSON.parse(body);
                                            console.log(("Image Record Succesfully added at Image ID: " + body.images[0].id).green);
                                            callback();
                                        }else{
                                            callback({error : "API Request Error: " + JSON.stringify(error)});
                                        };
                                    });
                                }
                            });

                        }else{//Attach ID to related archive.
                            console.log('Image Match Found'.blue);
                            var attachImageId = response.images[0].id;
                            request.put(settings.endpoints.cba + "/" + cba_id , {body : { "attach_image_id" : attachImageId}, json : true, headers : {'Authorization' : settings.access_token}}, function (error, response, body) {//TODO: This should eventually be a JSON raw body not a form
                                if (!error && response.statusCode == 204) {
                                    console.log(("Image ID: " + attachImageId + " success attached to " + cba_id).green);
                                    callback();
                                }else{
                                    callback({error : "API Request Error: " + JSON.stringify(error)});
                                }
                            });
                        }


                    }
                ], function(err, result){
                    if(err) {
                        callback(err);
                    }else {
                        pages[basename] = user_images_uploads_key_without_ext;
                        callback();
                    }
                });
            }, function(err){
                if(err) {
                    callback(err);
                }else {
                    callback(null, pages);
                }

            });
        },
        function(pages, callback){
            console.log('Ready to sort.'.rainbow);

            pages.natsort();
            var pages_final = [];
            for (var items in pages){
                pages_final.push(pages[items]);
            }

            pages_final.unshift('presentation_value');
            delete pages_final[0];
            pages_final = pages_final.toObject();

            //console.log(JSON.stringify(pages_final).rainbow);

            request.put(settings.endpoints.cba + "/" + cba_id , {body : { "comic_book_archive_status" : 1, "comic_book_archive_contents" : pages_final}, json : true, headers : {'Authorization' : settings.access_token}}, function (error, response, body) {//TODO: This should eventually be a JSON raw body not a form
                if (!error && response.statusCode == 204) {
                    console.log(("Comic Book Archive Update Successful").green);
                    callback();
                }else{
                    //context.fail(("API Request Error: " + JSON.stringify(error)).red);
                    callback({error : "API Request Error: " + JSON.stringify(error)});
                }
            });
        }
    ],
    function(err, results){
        //TODO: Post error to DB if fails and write to error log
        if(err){
            request.put(settings.endpoints.cba + "/" + cba_id , {body : { "comic_book_archive_status" : 2}, json : true, headers : {'Authorization' : settings.access_token}}, function (error, response, body) {
                //console.log(body.green);
                if (!error && response.statusCode == 204) {
                    console.log(("Comic Book Archive Update Successful").green);
                    context.fail("Error: "+  JSON.stringify(err));
                }else{
                    context.fail("Comic Book Archive Update Process Failed: " + error);
                }
            });
        }else {
            context.succeed('Comic Book Archive successfully processed.'.green);
        }
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
