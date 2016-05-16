"use strict";
/* global gus garry:true */
/* eslint no-warning-comments: [1, { "terms": ["todo", "fix", "help"], "location": "anywhere" }] */

// Setup Node Modules
var http = require("http"),
	url = require("url"),
	fs = require("fs"),
	io = require("socket.io"),
	cron = require("cron"),
	five = require("johnny-five"),
	CronJob = cron.CronJob,
	CronTime = cron.CronTime,
	
	port = process.argv[2] || 8000, // The port to serve the server on.
	schedule = {}, // All the cron jobs are kept in this object.
	identification = 0, // All cron jobs have an identification so it can be targetted.
	board = new five.Board(); // The Arduino board.

// Very Basic Server
var server = http.createServer(function createServerInner (request, response) {
	var path = url.parse(request.url).pathname;

	fs.readFile(__dirname + "/index.html", function fsReadFileInner (error, data) {
		console.log("__dirname: " + __dirname + ", path: " + path + ", error: " + error);
		response.writeHead(200, {"Content-Type": "text/html"});
		response.write(data, "utf8");
		response.end();
	});
}).listen(port);

// Socket.io Setup
var listener = io.listen(server);

// Arduino Control - Everything that controls the Arduino must be inside this function
board.on("ready", function arduinoControl () {
	// Setup Variables
	var startDegree = 90,
		counter = 0;

	// Setup Entities
	var button = new five.Button(8);
	var servo = new five.Servo({
		pin: 9,
		range: [0, 155], // Default: 0-180 TODO change with new servo
		startAt: startDegree
	});

	// Setup REPL
	this.repl.inject({
		led: new five.Led(13),
		button: button,
		servo: servo
	});

	// Socket.io Control
	listener.sockets.on("connection", function connectionDetected (socket) {
		console.log(schedule);
		// Send Old Timers
		socket.on("readyForOldSchedule", function sendingOldSchedule () {
			var newSchedule = {};
			for (var key in schedule) {
				if (schedule.hasOwnProperty(key) && key.indexOf("settings") > -1) {
					newSchedule[schedule[key].id] = schedule[key];
				}
			}
			socket.emit("oldSchedule", newSchedule);
		});

		// Servo Control
		function moveServo (waitTimeManual) {
			var waitTime;
			socket.emit("servoStarted");
			
			if (isNaN(waitTimeManual)) {
				waitTime = 250;
			} else {
				waitTime = Number(waitTimeManual);
			}

			console.log("Moving servo. Wait time: " + waitTime + ", counter: " + counter);
			counter++;
			servo.to(75);
			board.wait(waitTime, function moveServoPart2 () {
				servo.home();
				board.wait(waitTime, function moveServoPart3 () {
					socket.emit("servoFinished");
				});
			});
		}

		// Arduino Push Button Control
		button.on("release", function buttonPressed () { moveServo(); });

		// Feed Button
		socket.on("feed", function userWantsToFeed (data) {
			moveServo();
		});

		// Cron Job
		function createJob (newTime, ts) {
			// Create Job
			schedule["cron" + identification] = new CronJob({
				cronTime: newTime,
				onTick: moveServo,
				start: true,
				timeZone: "Pacific/Honolulu"
			});

			ts.id = identification;
			schedule["settings" + identification] = ts;
			schedule["settings" + identification].status = "on";
			identification++;

			// Send to Client-Side
			socket.emit("newSchedule", ts);
		}

		// Cron Times
		socket.on("serverNewTimer", function serverNewTimerInner (ts) {
			var convertedHour, convertedJob, job = [], dayOfWeekMap = {
				Sunday: "0",
				Monday: "1",
				Tuesday: "2",
				Wednesday: "3",
				Thursday: "4",
				Friday: "5",
				Saturday: "6",
				ed: "*",
				eod: "*/2"
			};

			// Convert 1-12 am/pm to 0-23, by converting string to number, then converting back
			convertedHour = (ts.ampmSelect === "pm" && ts.hourSelect < 12) ?
				(Number(ts.hourSelect) + 12) : (ts.ampmSelect === "am" && ts.hourSelect === "12") ?
				0 : ts.hourSelect;

			// Ccreate Cron Time Array
			job[0] = "00"; 							// Seconds: 0-59
			job[1] = ts.minutesSelect; 				// Minutes: 0-59
			job[2] = convertedHour;					// Hours: 0-23
			job[3] = "*"; 							// Day of Month: 1-31
			job[4] = "*"; 							// Months: 0-11
			job[5] = dayOfWeekMap[ts.daySelect]; 	// Day of Week: 0-6

			console.log(job);
			// var convertedJob = new CronTime(job.join(" "));
			createJob(job.join(" "), ts);
		});

		// Toggling Cron Jobs
		socket.on("toggleTimer", function toggleTimerInner (toggleSettings) {
			var id = toggleSettings.id, newVal = toggleSettings.newVal;
			if (newVal === "on") {
				schedule["cron" + id].start();
				schedule["settings" + id].status = "on";
			} else {
				schedule["cron" + id].stop();
				schedule["settings" + id].status = "off";
			}
		});

		// Deleting Cron Jobs
		socket.on("deleteTimer", function deleteTimerInner (deleteSettings) {
			var id = deleteSettings.id;
			schedule["cron" + id].stop();
			delete schedule["cron" + id];
			delete schedule["settings" + id];
			socket.emit("deleteFromSchedule", {"id": id});
		});
	});
});