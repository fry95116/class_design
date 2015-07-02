$(document).ready(function(){
	$('#user_info').submit(function(){
		$.get('/getSurvey',function(data,status){
			if(status==='success'){
				$('#survey').html(data);
			}
		});
		return false;
	});
});