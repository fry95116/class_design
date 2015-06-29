/*
 使用了ECharts
网址：http://echarts.baidu.com/index.html
*/

var myChart=[];
$(document).ready(function() {

	//初始化ECharts
	require.config({
		paths: {
			echarts: './js'
		}
	});
	require(
		[
			'echarts',
			'echarts/chart/line'
		],
		function(echart) {
			myChart[0] = echart.init($('.panel')[0]);
			myChart[1] = echart.init($('.panel')[1]);
			myChart[2] = echart.init($('.panel')[2]);
			myChart[3] = echart.init($('.panel')[3]);
			var option = {
				title: {
					text: 'temperature_in',
				},
				tooltip: {
					formatter: function(params) {
						var date = new Date(params.value[0]);
						data = date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate() + ' ' + date.getHours() + ':' + date.getMinutes() + ':' + date.getSeconds();
						return data + '<br/>' + params.value[1];
					}
				},
				dataZoom: {
					show: true
				},
				xAxis: [{
					type: 'time',
				}],
				yAxis: [{
					type: 'value'
				}],
				series: [{
					name: "temperature_in",
					type: "line",
					smooth: false,
					showAllSymbol: true,
					data: [
						[new Date(), 0]
					]
				}],
				animation: false
			};
			// 为echarts对象加载数据 
			myChart[0].setOption(option);
			myChart[0].setOption({title : {text : 'temperature_in'}});
			myChart[1].setOption(option);
			myChart[1].setOption({title : {text : 'temperature_out'}});
			myChart[2].setOption(option);
			myChart[2].setOption({title : {text : 'sand'}});
			myChart[3].setOption(option);
			myChart[3].setOption({title : {text : 'height'}});
		}
	);

	//绑定resize()
	$(window).resize(function() {
		myChart[0].resize();
		myChart[1].resize();
		myChart[2].resize();
		myChart[3].resize();
	});
	//提交事件
	$('#getdata').submit(function() {
		$(this).ajaxSubmit({
			dataType: 'json', //here
			success: function(res) {
				var re = [],
				//解析日期字符串
				getDate = function(str) {
					var exp = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/;
					if (!exp.test(str)) return undefined;
					var str1 = str.split(' ');
					str1[0] = str1[0].split('-');
					str1[1] = str1[1].split(':');
					return new Date(str1[0][0], str1[0][1], str1[0][2], str1[1][0], str1[1][1], str1[1][2]);
				},
				//组装图表的model
				setupData=function(res){
					var re;
					if (!res.number) return undefined;
					for (i = 1; i <= res.number; ++i) {
						re.push([getDate(res['' + i].addtime), res['' + i].temperature+MAth.random()*10]);
					}
				}
				
				//设置model
				var series = [{
					name: "temperature",
					type: "line",
					smooth: false,
					showAllSymbol: true,
					data: readInput(re)
				}];
				myChart.setSeries(series);
			}
		});
		return false;
	});

});

function ref(res){
	//解析日期字符串
	var getDate = function(str) {
		var exp = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/;
		if (!exp.test(str)) return undefined;
		var str1 = str.split(' ');
		str1[0] = str1[0].split('-');
		str1[1] = str1[1].split(':');
		return new Date(str1[0][0], str1[0][1], str1[0][2], str1[1][0], str1[1][1], str1[1][2]);
	},
	//组装图表的model
	setupData=function(res){
		var re=[]
		if (!res.number) return undefined;
		for (i = 1; i <= res.number; ++i) {
			re.push([getDate(res['' + i].addtime), res['' + i].temperature+Math.random()*20]);
		}
		return re;
	};
	//设置model
	var series = [{
		name: "data",
		type: "line",
		smooth: false,
		showAllSymbol: true,
		data: setupData(res)
	}];
	myChart[0].setSeries(series);
	myChart[1].setSeries(series);
	myChart[2].setSeries(series);
	myChart[3].setSeries(series);
}

var test={"1":{"ID":"18146","addtime":"2015-05-16 14:42:13","temperature":"28"},"2":{"ID":"18145","addtime":"2015-05-16 14:41:59","temperature":"28"},"3":{"ID":"18144","addtime":"2015-05-16 14:40:39","temperature":"29"},"4":{"ID":"18143","addtime":"2015-05-16 14:18:04","temperature":"29"},"5":{"ID":"18142","addtime":"2015-05-16 14:17:57","temperature":"31"},"6":{"ID":"18141","addtime":"2015-05-16 14:17:50","temperature":"29"},"7":{"ID":"18140","addtime":"2015-05-16 14:17:43","temperature":"29"},"8":{"ID":"18139","addtime":"2015-05-16 14:17:35","temperature":"29"},"9":{"ID":"18138","addtime":"2015-05-16 11:49:37","temperature":"26"},"10":{"ID":"18137","addtime":"2015-05-16 11:49:30","temperature":"26"},"11":{"ID":"18136","addtime":"2015-05-16 11:49:29","temperature":"25"},"12":{"ID":"18135","addtime":"2015-05-16 11:49:28","temperature":"25"},"13":{"ID":"18134","addtime":"2015-05-09 16:19:50","temperature":"25"},"14":{"ID":"18133","addtime":"2015-05-09 16:19:43","temperature":"27"},"15":{"ID":"18132","addtime":"2015-05-09 16:19:37","temperature":"25"},"16":{"ID":"18131","addtime":"2015-05-09 16:17:10","temperature":"24"},"17":{"ID":"18130","addtime":"2015-05-09 16:17:03","temperature":"24"},"18":{"ID":"18129","addtime":"2015-05-09 16:16:56","temperature":"24"},"19":{"ID":"18128","addtime":"2015-05-09 16:16:51","temperature":"24"},"20":{"ID":"18127","addtime":"2015-05-08 22:33:15","temperature":"24"},"21":{"ID":"18126","addtime":"2015-05-08 22:33:08","temperature":"25"},"22":{"ID":"18125","addtime":"2015-05-08 22:33:00","temperature":"25"},"23":{"ID":"18124","addtime":"2015-05-08 22:32:53","temperature":"25"},"24":{"ID":"18123","addtime":"2015-05-08 22:32:47","temperature":"25"},"25":{"ID":"18122","addtime":"2015-05-08 22:32:10","temperature":"25"},"26":{"ID":"18121","addtime":"2015-05-08 22:30:14","temperature":"25"},"27":{"ID":"18120","addtime":"2015-05-08 22:30:06","temperature":"25"},"28":{"ID":"18119","addtime":"2015-05-08 22:29:59","temperature":"25"},"29":{"ID":"18118","addtime":"2015-05-08 22:29:52","temperature":"25"},"30":{"ID":"18117","addtime":"2015-05-08 22:29:45","temperature":"25"},"number":"30"};
