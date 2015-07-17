/**
 * Created by Michael on 02/07/15.
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
var moment = require('moment');
var async = require('async');


exports.handler = function(event, context) {

    console.log( "Running index.handler" );
    var user_upload_bucket = event.bucket_name;
    var user_upload_key = event.file_name;
    var cba_id = event.cba_id;

    if(!user_upload_bucket || !user_upload_key || !cba_id){
        context.fail((
            "Missing Parameter.\n" +
            "Bucket: " + user_upload_bucket + "\n" +
            "Key: " + user_upload_key + "\n" +
            "CBA ID: " + cba_id + "\n"
        ).red);
    }

    var result = null;

    /*var connection = mysql.createConnection({
        host     : process.env.AWS_DB_HOST,
        database : process.env.AWS_DB_DATABASE,
        user     : process.env.AWS_DB_USER,
        password : process.env.AWS_DB_PASS
    });*/

    //connection.connect();//DB Connect

    async.waterfall([
        function(callback){//first
            s3.getObject({Bucket: user_upload_bucket, Key: user_upload_key}, function(err, data) {//Retrieve Upload
                if (err) {
                    console.log("Error getting object " + user_upload_key + " from bucket " + user_upload_bucket +
                    ".\nMake sure they exist and your bucket is in the same region as this function.".red);
                    context.fail("Error getting file: " + JSON.stringify(err).red);
                } else {
                    console.log(("Successfully retrieved data " + user_upload_bucket + "/" +user_upload_key).green);

                    var zip = new JSZip(data.Body);//Load archive into JSZip

                    var pages = [];

                    async.forEachOf(zip.files, function (file, filename, callback) {
                        console.log("Processing file: ".green + filename.blue);

                        if(filename.substr(-1) === "/" ){
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
                                connection.query('SELECT * FROM comic_images WHERE image_hash = ? LIMIT 1', fileHash, function(err, result) {
                                      if (err) {
                                          context.fail(("Database Error: " + JSON.stringify(err)).red);
                                      }else{
                                          callback(null, result);
                                      }
                                });
                            },
                            function(result, callback){
                                if(result.length == 0) {

                                    console.log("Image Match Not Found".blue);

                                    var params = {
                                        Bucket: user_images_uploads,
                                        Key: user_images_uploads_key,
                                        Body: user_images_uploads_body
                                    };

                                    s3.putObject(params, function(err, data) {
                                        if (err) {
                                            console.log(("Error putting object " + user_images_uploads_key + " into bucket " + user_images_uploads +
                                            ".\nMake sure they exist and your bucket is in the same region as this function.").red);
                                            context.fail(("Error getting file: " + JSON.stringify(err)).red);
                                        } else {
                                            console.log("Successfully uploaded data to " + user_images_uploads + "/" +user_images_uploads_key);

                                            var image_data = {
                                                image_slug : user_images_uploads_key_without_ext,
                                                image_hash : fileHash,
                                                image_size : 1,//fileSize
                                                created_at : moment().format('YYYY-MM-DD HH:mm:ss'),
                                                updated_at : moment().format('YYYY-MM-DD HH:mm:ss')

                                            };

                                            connection.query('INSERT INTO comic_images SET ?', image_data, function(err, result) {
                                                if (err) context.fail(("Database Error: " + JSON.stringify(err)).red);
                                                console.log('New Comic Image Entry: '.green + JSON.stringify(image_data).blue);

                                                image_id = result.insertId;

                                                var pivot_entry = {
                                                    comic_book_archive_id : cba_id,
                                                    comic_image_id : image_id,
                                                    created_at : moment().format('YYYY-MM-DD HH:mm:ss'),
                                                    updated_at : moment().format('YYYY-MM-DD HH:mm:ss')
                                                };

                                                callback(null, pivot_entry);

                                            });

                                        }

                                    });


                                }else{

                                    image_id = result[0].id;
                                    user_images_uploads_key = result[0].image_slug + "." + fileExt;
                                    console.log('Image Match Found'.green);
                                    image_exists = true;

                                    var pivot_entry = {
                                        comic_book_archive_id : cba_id,
                                        comic_image_id : image_id,
                                        created_at : moment().format('YYYY-MM-DD HH:mm:ss'),
                                        updated_at : moment().format('YYYY-MM-DD HH:mm:ss')
                                    };

                                    callback(null, pivot_entry);

                                }
                            },
                            function(pivot_object, callback){

                                //Entry into Pivot Table
                                connection.query('INSERT INTO comic_book_archive_comic_image SET ?', pivot_object , function(err, result) {
                                    if (err) context.fail("Database Error: " + JSON.stringify(err).red);
                                    console.log('New Comic Book Archive/Comic Image Pivot Entry: '.green + JSON.stringify(pivot_object).blue);
                                    callback();
                                });

                            }
                        ], function(err, result){
                            pages[basename] = user_images_uploads_key_without_ext;
                            callback();
                        });

                    }, function (err) {
                        callback(null, pages);
                    });

                }
            });
        },//end of first
        function(pages, callback){//second
            console.log('Ready to sort.'.rainbow);

            pages.natsort();
            var pages_final = [];
            for (var items in pages){
                pages_final.push(pages[items]);
            }

            pages_final.unshift('presentation_value');
            delete pages_final[0];
            pages_final = pages_final.toObject();

            //console.log(JSON.stringify(pages_final));

            connection.query('UPDATE `comic_book_archives` SET `comic_book_archive_contents` = ? WHERE `id` = ?', [JSON.stringify(pages_final), cba_id], function(err, result) {
                if (err) context.fail(("Database Error: " + JSON.stringify(err)).red);
                console.log(("JSON Successfully written to comic_book_archives.comic_book_archive.id " + cba_id + ": ").green + JSON.stringify(pages_final).blue);

                connection.query('UPDATE `comics` SET `comic_book_archive_contents` = ? , `comic_status` = 1 WHERE `comic_book_archive_id` = ?',[JSON.stringify(pages_final), cba_id], function (err, result) {
                    if (err) context.fail(("Database Error: " + JSON.stringify(err)).blue);
                    console.log(("JSON Successfully written to comics.comic_book_archive_id " + cba_id + ": ").green + JSON.stringify(pages_final).blue);
                    callback();
                });
            });//TODO: This will need to alter laravel's cache somehow... *sigh*

        }//end of second
    ],
    function(err, results){
        connection.end();
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
