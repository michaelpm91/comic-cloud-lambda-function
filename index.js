/**
 * Created by Michael on 26/06/15.
 */
console.log('Loading function');
var aws = require('aws-sdk');
var s3 = new aws.S3();//{apiVersion: '2006-03-01'});
var fs = require('fs');
var JSZip = require("jszip");
var path = require("path");
var mkdirp = require('mkdirp');
var uuid = require('uuid');
var getFileType = require('file-type');
//var rar = require('node-rar');


exports.handler = function(event, context) {
    console.log( "Running index.handler" );
    var user_upload_bucket = event.bucket.name;
    var user_upload_key = event.object.file_name;
    s3.getObject({Bucket: user_upload_bucket, Key: user_upload_key}, function(err, data) {//Retrieve Upload
        if (err) {
            console.log("Error getting object " + user_upload_key + " from bucket " + user_upload_bucket +
            ".\nMake sure they exist and your bucket is in the same region as this function.");
            context.fail('Error', "Error getting file: " + err);
        } else {
            console.log("Successfully retrieved data " + user_upload_bucket + "/" +user_upload_key);
            var zip = new JSZip(data.Body);//Load archive into JSZip

            var pages = [];

            Object.keys(zip.files).forEach(function(filename) {
                //console.log('file name:' + filename);
                var fileType = getFileType(zip.files[filename].asNodeBuffer());
                var acceptedExtensions = ['jpg', 'jpeg'];
                if(filename.substr(-1) === "/" ){
                    console.log('Directory found.'); return;
                }
                if(acceptedExtensions.indexOf(fileType.ext.toLowerCase()) == -1){
                    console.log('Unaccepted File type \'' + fileType.ext + '\' found.'); return;
                }

                var user_images_uploads = 'comicclouddevelopimages';
                var user_images_uploads_key = uuid.v4() + "." + fileType.ext;
                var user_images_uploads_body = zip.files[filename].asNodeBuffer();
                var params = {
                    Bucket: user_images_uploads,
                    Key: user_images_uploads_key,
                    Body: user_images_uploads_body
                };
                //console.log(user_images_uploads_key);
                s3.putObject(params, function(err, data) {
                    if (err) {
                        console.log("Error putting object " + user_images_uploads_key + " into bucket " + user_images_uploads +
                        ".\nMake sure they exist and your bucket is in the same region as this function.");
                        context.fail('Error', "Error getting file: " + err);
                    } else {
                        console.log("Successfully uploaded data to " + user_images_uploads + "/" +user_images_uploads_key);
                    }
                });

                pages[image_slug] = $file;

            });
            //context.succeed();
        }
    });
}