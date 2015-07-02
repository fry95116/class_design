$(document).ready(function(){
	$('#user_info').submit(function(){
		$.get('/getSurvey',function(data,status){
			if(status==='success'){
				$('#survey').html(data);
			}
		});
		$.post('/getCourse',$(this).serialize(),function(data,status){
			console.log(data);
			console.log(status);
		})
		return false;
	});
});