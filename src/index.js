var express = require('express'),
	bodyparser = require('body-parser'),
	mssql = require('mssql'),
	app = express(),
	http = require('http'),
	_=require('lodash');
/******************** **  数据库部分  **********************/
var config = {
	user: 'sa',
	password: 'abc7758258',
	server: '127.0.0.1',
	port: 1433,
	database: 'classDesign',
	options: {
		useUTC: false
	}
};
var request = null;
var connection = new mssql.Connection(config);
connection.connect(function (err) {
	if (err) console.log(err);
	request = new mssql.Request(connection); // or: var request = connection.request(); 
	/*request.query('exec checkLogin 1001,\'12345\'',function(err,res){
		if(err) console.log(err);
		console.log(res);
	});*/
});

/************************express部分************************/
/************************  中间件  *************************/
//评级等级
var rank = [{ value: 1, text: '差' }, { value: 2, text: '中' }, { value: 3, text: '良' }, { value: 4, text: '好' }];
var tr_rank=['差','中','良','好'];
app.set("view engine", "ejs");
app.set("view options", { "layout": false });
app.use(bodyparser.urlencoded({ extended: true })); //post请求
app.use('/', express.static(__dirname + '/static')); //处理静态文件

app.get('/', function (req, res) {
	res.sendFile(__dirname + '/views/index.html');
});

//登陆检查
app.use(['/getCourse', '/getInfo','/commit','/getCommits'], function (req, res, next) {
	//post参数检查，检查是否建立连接
	console.log(req.body);
	if (request != null
		&& req.body.id
		&& req.body.id !== ''
		&& req.body.pwd
		&& req.body.pwd !== '') {
		//查询
		request.query('exec checkLogin ' + req.body.id + ',\'' + req.body.pwd + '\'', function (err, result) {
			//警告
			if (err) {
				console.log(err);
				req.loginCheck = -1;
				next();
				return;
			}
			//无数据（一般不可能出现）
			if (result.length != 0) {
				//有结果
				req.loginCheck = result[0].status;
				next();
			}
			else {
				req.loginCheck = -1;
				next();
			}
		});
	}
	else {
		req.loginCheck = -1;
		next();
	}
});

/***********************  API部分  *****************************/

/*获得课程列表
input:id,pwd:
output:{
	loginAs:(string)"student"/"teacher",	//以什么角色登录
	course:(Array)[							//所学/所教课程列表
		{
			id:(int),						//课程id
			name:(string)					//课程名
		}			
	],
	err:(Object)							//错误信息
}*/

app.post('/getCourse', function (req, res) {
	if (req.loginCheck == 0) {
		//res.render('course',result);
		res.send({err:'check failed'});
	}
	//作为学生
	else if (req.loginCheck == 1) {
		request.query('exec getCourseByStudentId ' + req.body.id, function (err, result) {
			if (err){
				console.log(err);
				res.send({err:err});
			}
			res.send('course', { loginAs:'student',course: result });
		});
	}
	//作为教师
	else if (req.loginCheck == 2) {
		request.query('exec getCourseByTeacherId ' + req.body.id, function (err, result) {
			if (err){
				console.log(err);
				res.send({err:err});
			}
			res.send({ loginAs:'teacher',course: result });
		});
	}
});

/*获得调查问卷
input:无
output:{
	rank:(Array)[						//评级列表
		{
			text:(string),				//等级名（好/中/差。。。。）
			value:(int)					//等级值
		}
	],
	rank_items:(Array)[					//评级项目
		{
			id:(int),					//评级项目id
			text:(string)				//评级项目内容
		}
	],
	err:(Object)						//错误信息
}*/
app.get('/getSurvey', function (req, res) {
	//返回调查问卷
	request.query('exec getRankItems', function (err, result) {
		if (err){
			console.log(err);
			res.send({err:err});
		}
		res.send({ rank_items: result, rank: rank });
	});
});
/*进行评论
	input：id,pwd,cid,rank_items中的id，text
	output
	{
		res:ok;
		err:(object)
	}
*/
app.post('/commit', function (req, res) {
	if(req.loginCheck==1){
		var qstr='exec commitCourse '+req.body.id+','+req.body.cid+',\''+req.body.text+'\'';
		//console.log(qstr);
		//添加commit条目
		request.query(qstr, function (err, result) {
			if (err){res.send({err:err});return;}
			//获得问卷项目
			request.query('exec getRankItems', function (err, result) {
				if (err){res.send({err:err});return;}
				//添加评级，并发的
				var count=0;
				for(i=0;i<result.length;i++){
					if(req.body[result[i].id]){count++;}
				}
				for(i=0;i<result.length;i++){
					if(req.body[result[i].id]){
						request.query('exec addRank '+req.body.id+','+req.body.cid+','+result[i].id+','+req.body[result[i].id],function(err,result){
							if (err){res.send({err:err});return;}
							count--;
							if(count==0){
								console.log('ended');
								res.send({res:'ok'});
							}
						});
					}
				}
			});//getRankItems
		});
	}
});
/*
评级情况查询
input:id,pwd,cid
output:{
	items:(array)[{
		text:(string),
		sub:(array)[
			{rank_text:(string),count(int)}
		],
		ranks:(array)[
			{rank_text:(string),count:(int)}
		]
	}],
	tr_rank(array)[(string)],
	texts[(string)]
}
*/
app.post('/getCommits',function(req,res){
	//登录检查
	//
	var re_data={},count=0;
	console.log(req.loginCheck);
	if(req.loginCheck==2&&typeof(req.body.cid) != "undefined"){
		request.query('exec getCommitByCourseId '+req.body.cid,function(err,result){
			count++;
			if(err){re_data.err=err;}
			re_data.texts=result;
			if(count==2){
				re_data.tr_rank=tr_rank;
				res.send(re_data);
			}
		});
		request.query('exec getRankCountByCourseId '+req.body.cid,function(err,result){
			count++;
			if(err){re_data.err=err;}
			re_data.items=_.map(_.groupBy(result,'text'),function(num,key){return {text:key,ranks:num}});
			if(count==2){
				re_data.tr_rank=tr_rank;
				res.send(re_data);
			}
		});
	}
});


http.createServer(app).listen(8080, function () {
	console.log('front listening on 8080');
});