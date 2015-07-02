var express=require('express'),
bodyparser = require('body-parser'),
mssql=require('mssql'),
app=express();
/*****************数据库部分****************/
var config = {
	user: 'sa',
	password: 'abc7758258',
	server: '127.0.0.1',
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
	request = new mssql.Request(connection); // or: var request = connection.request(); 
	/*request.query('exec checkLogin 1001,\'12345\'',function(err,res){
		if(err) console.log(err);
		console.log(res);
	});*/
});

/***********************express部分************************/
//模板
var rank=[{value:1,text:'差'},{value:2,text:'中'},{value:3,text:'良'},{value:4,text:'好'}];

app.set("view engine","ejs");
app.set("view options",{"layout":false});
app.use('/getCourse', bodyparser.urlencoded({extended: true})); //post请求
app.use('/',express.static(__dirname + '/static')); //处理静态文件

app.get('/',function(req,res){
	res.sendFile(__dirname + '/views/index.html');
});

app.post('/getCourse',function(req,res){
	//post参数检查，检查是否建立连接
	console.log(req.body);
	var re_data={};
	if(request!=null&&req.body.id&&req.body.pwd){
		//查询
		request.query('exec checkLogin '+req.body.id+',\''+req.body.pwd+'\'',function(err,result){
			//警告
			if(err) console.log(err);
			//无数据（一般不可能出现）
			if(result.length!=0){
				//检查失败
				if(result[0].status==0){
					//res.render('course',result);
					res.send('failed');
				}
				//作为学生
				else if(result[0].status==1){
					request.query('exec getCourseByStudentId '+req.body.id,function(err,result){
						if(err) console.log(err);
						//res.render('course',result);
						res.send('failed');
					});
				}
				//作为教师
				else if(result[0].status==2){
					request.query('exec getCourseByTeacherId '+req.body.id,function(err,result){
						if(err) console.log(err);
						//res.render('course',result);
						res.send('failed');
					});
				}
			}
		});
	}
	else{

		//res.render('course',result);
	}
});

app.get('/getSurvey',function(req,res){
	if(request!=null){
		request.query('exec getRankItems',function(err,result){
			if(err) console.log(err);
			res.render('survey',{rank_items:result,rank:rank});
		});
	}
});

app.listen(8080,function(){
	console.log('listening on 8080');
});