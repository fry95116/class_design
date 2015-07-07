//jquery插件：表单序列化为json对象
(function ($) {
	$.fn.serializeJSON = function () {
		var serializeObj = {};
		var array = this.serializeArray();
		var str = this.serialize();
		$(array).each(function () {
			if (serializeObj[this.name]) {
				if ($.isArray(serializeObj[this.name])) {
					serializeObj[this.name].push(this.value);
				} else {
					serializeObj[this.name] = [serializeObj[this.name], this.value];
				}
			} else {
				serializeObj[this.name] = this.value;
			}
		});
		return serializeObj;
	};
})(jQuery);

var options = {
	title: {
		show: true,
		text: '4.4',
		x: 'center',
		textStyle: {fontSize: 24}
	},
    tooltip: {
        trigger: 'item',
        formatter: "{b} : {c} ({d}%)"
    },
    calculable: true,
    series: [
        {
            type: 'pie',
            radius: ['50%', '70%'],
			itemStyle: {
                normal: {
                    label: {show: true},
                    labelLine: {show: true}
                },
                emphasis: {
                    label: {show: false}
                }
            },
            data: [
                { value: 1, name: 'a' }
            ]
        }
    ]
};

/*var subChartOptions = option = {
	title: {
		show: true,
		text: '4.4',
		x: 'center',
	},
    tooltip: {
        trigger: 'item',
        formatter: "{b} : {c} ({d}%)"
    },
    calculable: true,
    series: [
        {
            type: 'pie',
            radius: '55%',
			itemStyle: {
                normal: {
                    label: { show: false },
                    labelLine: { show: false }
                },
                emphasis: {
                    label: { show: false }
                }
            },
            data: [
                { value: 1, name: 'a' }
            ]
        }
    ]
};     */

$(document).ready(function () {
	//用户验证
	$('#user_info').submit(function () {
		/*$.get('/getSurvey', function (data, status) {
			if (status === 'success') {
				console.log(data);
			}
		});*/
		$.post('/getCourse', $(this).serialize(), function (data, status) {
			if (status === 'success') {
				//组装课程列表
				var cl=$('#course_list');
				cl.empty();
				for(i=0;i<data.course.length;i++){
					cl.append('<li class="list-group-item '+((i==0)?'active':'')+'" cid='+data.course[i].id+'>'+data.course[i].name+'</li>');			
				}
				cl.children().click(function(){
					cl.children().removeClass('active');
					$(this).addClass('active');
				});
				//如果是学生账号
				if(data.loginAs==='student'){
					$.get('/getSurvey', function (data, status) {
						if (status === 'success') {
							var form=$('#survey');
							form.empty();
							for(var i=0;i<data.rank_items.length;i++){
								var p='';
								p='<p class="item">'+(i+1)+'.'+data.rank_items[i].text+'</p><p class ="option">';
								for(j=0;j<data.rank.length;j++){
									p+='<label class="radio-inline">'+'<input type="radio" name="'+data.rank_items[i].id+'" value="'+data.rank[j].value+'">'+data.rank[j].text+'</label>';
								}
								p+='</p>';
								form.append(p);
							}
							form.append('<p><label for="text">Commit Text</label></p>'
							+'<textarea class="form-control" rows="5" name="text" placeholder="Say something,not necessary."></textarea>'
							+'<p><input id="submit" class="btn btn-success" type="submit" value="Commit"></p>');
						}
					});
				}
				//如果是教师账号
				if(data.loginAs==='teacher'){
					cl.children().click(function(){
						$.post('/getCommits',$('#user_info').serialize()+'&cid='+$(this).attr('cid'),function(data,status){
							if(status==='success'){
								$('#survey').empty();
								for(i=0;i<data.items.length;i++){
									$('#survey').append('<div class="subChart"></div>');
								}
								$('#survey').append('<div style="clear:both;">');
								$('.subChart').width(($('#survey').width()-5)*0.5).height(($('#survey').width()-5)*0.5);
								sc=_.map($('.subChart'),function(d){return echarts.init(d)});
								for(i=0;i<sc.length;i++){
									sc[i].setOption(options);
									sc[i].setOption({title:{text:data.items[i].text}});
									var series=[{data:_.map(data.items[i].ranks,function(iter){
										return {name:data.tr_rank[iter.rank-1],value:iter.count}
									})}];
									sc[i].setSeries(series);
								}
								var commit_panel='<div class="panel panel-default"><div class="panel-heading">Commit for my course</div><div class="list-group">'
								for(i=0;i<data.texts.length;i++){
									commit_panel+=' <a href="#" class="list-group-item">'+data.texts[i].commit_text+'</a>';
								}
								$('#survey').append(commit_panel+'</div></div>');
							}
						});
					});
					cl.children().first().trigger('click');
					/*$.post('/getCommits',$('#user_info').serialize()+'&cid=4',function(data,status){
						if(status==='success'){
							//数据处理
							var d=data,sub={};
							_.each(d.items,function(data){
							    _.each(data.ranks,function(sd){
									if(typeof(sub[sd.rank])==='undefined'){
										sub[sd.rank]=sd.count;
									}else{
										sub[sd.rank]+=sd.count
									}
								});
							});
							console.log(sub);
						}
					});*/
				}
			}
		});
		return false;
	});
	
	$('#survey').submit(function () {
		if(!check($('#survey').serializeJSON())){
			return false;
		}
		$.post('/commit', $(this).serialize()
			+'&cid='+$('#course_list .active').attr('cid')+'&'
			+$('#user_info').serialize(), function (data, status) {
			if (status === 'success') {
				console.log(data);
			}
		});
		return false;
	});
});

function check(form) {
	var names=[];
	$('#survey input,textarea').each(function(){
		names.push(this.name);
	});
	names=_.chain(names).uniq().initial().value();
	for (i in names){
		if(!validate_required(form[names[i]])){
			console.log('item '+i+' is empty');
			return false;
		}
	}
	return true;
};

function validate_required(field) {
	if (field==undefined) {
		return false;
	}
	else{
		return true;
	}
};