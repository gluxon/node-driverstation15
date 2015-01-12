var driverstation = (require('..'));

var options = {
  teamNumber: 178
};

driverstation.start(options);

driverstation.on('connect', function() {
  console.log("connected!");
});

driverstation.on('disconnect', function() {
  console.log("disconnected");
});
