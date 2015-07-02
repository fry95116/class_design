/*********************������Ŀ����*************************/
/******���*******/
create proc addRankItem 
	@text varchar(255)
as
	insert into rank_items ([text]) values (@text);
GO
/******ɾ��*******/
create proc deleteRankItem 
	@rid int
as
	delete from rank_items where id=@rid;
GO
/******�޸�*******/
create proc updateRankItem
	@rid int,
	@text varchar(255)
as
	update rank_items set [text]=@text where id=@rid;
GO
/******��ѯ*******/
create proc getRankItems
as
	select * from rank_items;
GO

/*********************ѧ�����ۿγ�*************************/
/******��ѯ��ѡ�γ�*******/
create proc getCourseByStudentid 
	@sid int
as
	declare @a int
	select @a=class_id from student where id=@sid; 
	select course.id,course.name 
	from major 
	inner join course 
	on course.id=major.course_id 
	where class_id=@a 
	union
	select course.id,course.name 
	from extra 
	inner join course 
	on course.id=extra.course_id 
	where student_id=@sid
GO
/******������ѡ�γ�*******/
create proc commitCourse 
	@committer_id int,
	@course_id int,
	@text varchar(255)=''
as
	insert into [commit] (committer_id,course_id,commit_text) values (@committer_id,@course_id,@text);
GO
/*
create proc getCourseByteacherid 
	@tid int
as
	select course.id,course.name 
	from course  
	where teacher_id=@tid;
GO

create proc getcommitByCourseId
	@cid int
as
	select * from [commit] where course_id=@cid;
GO*/