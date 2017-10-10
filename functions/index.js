const functions = require("firebase-functions");
const path = require("path");
const fs = require("fs");
const os = require("os");

const gcs = require("@google-cloud/storage")();
const ffmpeg = require("fluent-ffmpeg");
const ffmpeg_static = require("ffmpeg-static");

const speech = require("@google-cloud/speech")();

exports.transcribeAudio = functions.storage.object().onChange(event => {
  const object = event.data;
  const filePath = object.name;
  const fileName = filePath.split("/").pop();
  const fileBucket = object.bucket;
  const bucket = gcs.bucket(fileBucket);
  const tempFilePath = path.join(os.tmpdir(), fileName);

  // Exit if this is triggered on a file that is not an image.
  // Get the file name.
  //const fileName = path.basename(filePath);
  console.log(filePath + " name: " + fileName);
  // Exit if the image is already a thumbnail.
  if (!filePath.startsWith("ucl-flac-audio")) {
    console.log("Only flac-audio need to be converted");
    return true;
  }
  // Exit if this is a move or deletion event.
  if (object.resourceState === "not_exists") {
    console.log("This is a deletion event.");
    return true;
  }

  return Promise.resolve().then(() => {
    const audioFilename = "gs://" + fileBucket + "/" + filePath;
    console.log(audioFilename);
    const request = {
      config: {
        encoding: "FLAC",
        languageCode: "fr-FR"
      },
      audio: {
        uri: audioFilename
      }
    };

    return speech
      .longRunningRecognize(request)
      .then(function(responses) {
        var operation = responses[0];
        console.log("Operation: ", operation);
        return operation.promise();
      })
      .then(function(responses) {
        console.log("Result: ", JSON.stringify(responses[0]));
        bucket.file("json/test.json").save(JSON.stringify(responses[0]));
        return responses[0];
      })
      .catch(function(err) {
        console.error("Failed to get transcript.", err);
        //    reject(err);
      });
  });
});

exports.extractAudio = functions.storage.object().onChange(event => {
  const object = event.data;
  const filePath = object.name;
  const fileName = filePath.split("/").pop();
  const fileBucket = object.bucket;
  const bucket = gcs.bucket(fileBucket);
  const tempFilePath = path.join(os.tmpdir(), fileName);

  // Set the ffmpeg path to use the deployed binaries
  //const binPath =path.resolve(__dirname, "ffmpeg");
  const binPath = ffmpeg_static.path;
  //ffmpeg.setFfmpegPath(path.resolve(binPath, "ffmpeg"));
  //ffmpeg.setFfprobePath(path.resolve(binPath, "ffprobe"));

  ffmpeg.setFfmpegPath(binPath);
  ffmpeg.setFfprobePath(binPath);
  console.log(binPath);

  // Exit if this is triggered on a file that is not an image.
  // Get the file name.
  //const fileName = path.basename(filePath);
  console.log(filePath + " name: " + fileName);
  // Exit if the image is already a thumbnail.
  if (!filePath.startsWith("ucl-uploads")) {
    console.log("Only uploads need to be converted");
    return;
  }
  // Exit if this is a move or deletion event.
  if (object.resourceState === "not_exists") {
    console.log("This is a deletion event.");
    return;
  }

  return Promise.resolve()
    .then(() => {
      console.log("downloading audio file...");
      console.log("Filename: " + fileName);
      //return downloadFile(audioFile, event.data.name);
      console.log("tempFilePath: " + tempFilePath);
      return bucket
        .file(filePath)
        .download({ destination: tempFilePath })
        .catch(err => {
          console.error("Failed to download file.", err);
          return Promise.reject(err);
        });
    })
    .then(fileinfo => {
      return new Promise((resolve, reject) => {
        console.log("Start conversion");
        ffmpeg(tempFilePath)
          .inputOptions("-vn")
          .format("flac")
          .audioChannels(1)
          .output("/tmp/output.flac")
          .on("end", function() {
            resolve("/tmp/output.flac");
            console.log("extracted audio");
          })
          .on("error", function(err, stdout, stderr) {
            reject(err);
          })
          .run();
      });
    })
    .then(flacOutput => {
      return new Promise((resolve, reject) => {
        // TODO: upload FLAC file to Cloud Storage
        console.log("Start upload");
        bucket.upload(
          "/tmp/output.flac",
          { destination: "ucl-flac-audio/test.flac" },
          function(err, file, apiResponse) {
            if (err) {
              console.log("Error uploading file", err);
              return reject(err);
            }
            console.log("File uploaded");
            resolve();
          }
        );
      });
    })
    .catch(err => {
      return Promise.reject(err);
    });
});
