/**
 * Created by Michael on 26/06/15.
 */
console.log('Loading function');
var aws = require('aws-sdk');
var s3 = new aws.S3();//{apiVersion: '2006-03-01'});
var JSZip = require("jszip");
var path = require("path");
var uuid = require('uuid');
var crypto = require('crypto');
var getFileType = require('file-type');//TODO: Remove?
var mysql = require('mysql');
require('pro-array');
var orm = require("orm");
require('dotenv').load();
var fs = require('fs');
var colors = require('colors');

exports.handler = function(event, context) {
    console.log( "Running index.handler" );
    var user_upload_bucket = event.bucket.name;
    var user_upload_key = event.object.file_name;
    s3.getObject({Bucket: user_upload_bucket, Key: user_upload_key}, function(err, data) {//Retrieve Upload
        if (err) {
            console.log("Error getting object " + user_upload_key + " from bucket " + user_upload_bucket +
            ".\nMake sure they exist and your bucket is in the same region as this function.");
            context.fail("Error getting file: " + JSON.stringify(err));
        } else {
            console.log("Successfully retrieved data " + user_upload_bucket + "/" +user_upload_key);

            var connection = mysql.createConnection({
                host     : process.env.AWS_DB_HOST,
                database : process.env.AWS_DB_DATABASE,
                user     : process.env.AWS_DB_USER,
                password : process.env.AWS_DB_PASS
            });

            //DB Image Write
            connection.connect();//TODO: Move this Up

            var zip = new JSZip(data.Body);//Load archive into JSZip

            var pages = [];


            Object.keys(zip.files).forEach(function(filename) {

                var fileExt = path.extname(filename).split('.').join('');

                var acceptedExtensions = ['jpg', 'jpeg'];
                if(filename.substr(-1) === "/" ){
                    console.log('Directory found.'); return;
                }
                if(!acceptedExtensions.hasObject(fileExt)){
                    console.log('Unaccepted File type \'' + fileExt + '\' found.'); return;
                }
                var fileType = getFileType(zip.files[filename].asNodeBuffer());
                var basename = path.basename(filename, path.extname(filename));
                var fileSize = 1;//TODO: File size check.

                var user_images_uploads = 'comicclouddevelopimages';
                var user_images_uploads_key_without_ext = uuid.v4();
                var user_images_uploads_key = user_images_uploads_key_without_ext + "." + fileExt;
                var user_images_uploads_body = zip.files[filename].asNodeBuffer();

                var fileHash = crypto.createHash('md5').update(user_images_uploads_body).digest('hex');

                connection.query('SELECT * FROM comic_images WHERE image_hash = ? LIMIT 1', fileHash, function(err, result) {
                    if (err) throw err;
                    if(result) {
                        console.log(JSON.stringify(result).green);
                        console.log(result[0].id);
                    }
                });

                var params = {
                    Bucket: user_images_uploads,
                    Key: user_images_uploads_key,
                    Body: user_images_uploads_body
                };


                s3.putObject(params, function(err, data) {
                    if (err) {
                        console.log("Error putting object " + user_images_uploads_key + " into bucket " + user_images_uploads +
                        ".\nMake sure they exist and your bucket is in the same region as this function.");
                        context.fail("Error getting file: " + JSON.stringify(err));
                    } else {
                        console.log("Successfully uploaded data to " + user_images_uploads + "/" +user_images_uploads_key);


                        var image_data = {
                            image_slug : user_images_uploads_key_without_ext,
                            image_hash : fileHash,
                            image_size : 1//fileSize
                        };

                        connection.query('INSERT INTO comic_images SET ?', image_data, function(err, result) {
                            if (err) throw err;
                            //console.log(result);
                            console.log('New Comic Image Entry: ' + JSON.stringify(image_data));
                        });

                        //connection.end();//TODO: Move this down
                    }
                });

                pages[basename] = user_images_uploads_key;

            });

            pages.natsort();
            var pages_final = [];
            for (var items in pages){
                pages_final.push(pages[items]);
            }

            pages_final.unshift('presentation_value');
            delete pages_final[0];
            pages_final = pages_final.toObject();
            console.log(JSON.stringify(pages_final));

            //context.succeed();
        }
    });
}

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
