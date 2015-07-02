var mssql = require('mssql');

var config = {
	user: 'sa',
	password: 'abc7758258',
	server: 'localhost',
	port: 1433,
	database: 'classDesign',
	options:{
		useUTC:false
	}
};
var request=null;
var connection = new mssql.Connection(config);
connection.connect(function(err) {
	if(err) console.log(err);
	var request = new mssql.Request(connection); // or: var request = connection.request(); 
	request.query('exec checkLogin 1001,\'12345\'',function(err,res){
		if(err) console.log(err);
		console.log(res);
	});
});
