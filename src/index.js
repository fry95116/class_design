var express=require('express'),
bodyparser = require('body-parser'),
sql=require('mssql'),
app=express();

app.use('/submit', bodyparser.urlencoded({extended: true})); //post请求

app.use('/',express.static(__dirname + '/static')); //处理静态文件

app.get('/test',function(req,res){
	res.sendFile(__dirname+'/view/index.html')
});

app.get('/admin',function(req,res){

});

app.listen(8080,function(){
	console.log('listening on 8080');
});