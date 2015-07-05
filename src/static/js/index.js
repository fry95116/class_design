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