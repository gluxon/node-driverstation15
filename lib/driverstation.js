// Copyright (c) 2015 Brandon Cheng <gluxon@gluxon.com> (https://gluxon.com)
// node-driverstation: Node.js API for the client-side FRC Driver Station
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var dgram = require('dgram');
var crc32 = require('buffer-crc32');
var util = require('util');
var Duplex = require('stream').Duplex;

require('./isInteger'); // Number.isInteger polyfill

// UDP ports each device is listening on
var roboRIO_port = 1110;
var ds_port = 1150;

// The control bytes here were obtained from Wireshark. See:
// wiki page: https://github.com/gluxon/node-driverstation15/wiki/2015-Protocol
// progress: https://github.com/gluxon/node-driverstation15/issues/1
var MODES = {
  'Disabled': 0x00,
  'TeleOperated': 0x04,
  'Autonomous': 0x06,
  'Test': 0x05,
  'Emergency Stop': 0x80
}

// These bytes are sent when a reboot/restart is requested. They were also
// obtained through Wireshark. REBOOT_ACTION may not be an accurate name if
// other purposes are observed in the future.
// The Idle code was observed to be sent when no reboot/restart action was
// being requested in that moment. Further analysis may reveal it to mean more
// than "no action currently".
var REBOOT_ACTION = {
  'Idle': 0x10,
  'Robot Code': 0x14,
  'roboRIO': 0x18
}

// Period for each packet we send in ms
var updateInterval = 0.02 * 1000; // 0.02s (50Hz)
var slowUpdateInterval = 1000; // 1s (1Hz)

util.inherits(DriverStation, Duplex);

function DriverStation(streamOpts) {
  // Make "new" optional when instantiating this class
  if (!(this instanceof DriverStation)) return new DriverStation(streamOpts);

  // Objects read from this stream will be json objects (not buffers)
  if (streamOpts === undefined) streamOpts = {};
  streamOpts.objectMode = true;

  // We've inherited stream.Duplex, now call the superclass constructor
  Duplex.call(this, streamOpts);

  this.client = dgram.createSocket("udp4");

  this.connected = false;
  this.missedPackets = 0;

  // Construct a packet to send from information we currently know.
  this.dsData = {
    'ping': 1, // Bytes 1-2
    '3': 0x01, // Byte 3 Unknown
    'mode': MODES['Disabled'], // Byte 4
    'reboot_action': REBOOT_ACTION['Idle'], // Byte 5
    '6': 0x00 // Byte 6 Unknown
  }

  this.robotData = null;
}

DriverStation.prototype.start = function(opts) {
  if (opts === undefined)
    throw new Error('Options necessary');

  if (opts.teamNumber == undefined)
    throw new Error('Missing teamNumber from options');
  if (!Number.isInteger(opts.teamNumber) || opts.teamNumber < 1)
    throw new Error('Invalid teamNumber');

  this.teamNumber = opts.teamNumber;
  this.alliance = opts.alliance || 'red';
  this.position = opts.position || 1;

  this.roboRIO_host = 'roboRIO-' + this.teamNumber + '.local';
  this.waitForConnection();
}

DriverStation.prototype.waitForConnection = function() {
  var self = this;

  // Send packets at a slow rate into the vast universe to see if we can find
  // signs of intelligent life.
  this.findTimer = setInterval(function() {
    self.send();
  }, slowUpdateInterval);

  // Start listening for packets from robot
  this.listen();
};

DriverStation.prototype.send = function(callback) {
  // Send the 6-byte packet (nicknamed "general packet").
  var packet = new Buffer(6);
  packet.fill(0x00);

  packet.writeUInt16BE(this.dsData.ping, 0);
  packet.writeUInt8(this.dsData['3'], 2);
  packet.writeUInt8(this.dsData.mode, 3);
  packet.writeUInt8(this.dsData.reboot_action, 4);
  packet.writeUInt8(this.dsData['6'], 5);

  this.client.send(packet, 0, packet.length, roboRIO_port, this.roboRIO_host, callback);

  this.dsData.ping++;
};

DriverStation.prototype.connect = function(callback) {
  var self = this;

  // Connection established. Close our finding timer.
  clearInterval(self.findTimer);
  self.findTimer = null;

  // Start our normal rate timer.
  this.sendTimer = setInterval(function() {
    self.send();
    self.missedPackets++;
    self.disconnectCheck();
  }, updateInterval);

  this.connected = true;
  this.emit("connect");
};

DriverStation.prototype.disconnect = function(callback) {
  clearInterval(this.sendTimer);
  clearInterval(this.findTimer);

  this.connected = false;
  this.emit('disconnect');

  this.waitForConnection();
};

DriverStation.prototype.disconnectCheck = function() {
  if (this.missedPackets > 10) {
    this.disconnect();
    this.missedPackets = 0;
  }
};

DriverStation.prototype._read = function() {

}

DriverStation.prototype._write = function() {

}

DriverStation.prototype.listen = function() {
  var self = this;

  var server = dgram.createSocket('udp4');

  server.on('message', function (msg, rinfo) {
    if (!self.connected) {
      self.connect();
    }

    self.missedPackets = 0;
    self.push(self.parseRobotData(msg));
  });

  server.bind(ds_port);
};

DriverStation.prototype.parseRobotData = function(data) {
  var pong = data.readUInt16BE(0);
  var mode = data.readUInt8(3);
  var batteryVolts = data.toString('hex', 5, 6) + "." + data.toString('hex', 6, 7);

  return {
    'pong': pong,
    'mode': mode,
    'batteryVolts': batteryVolts
  }
}

module.exports = DriverStation();
