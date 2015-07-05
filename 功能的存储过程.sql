/*********************登陆检查*************************/
create proc checkLogin
	@uid int,
	@pwd varchar(255)
as
	if exists(select passwd from student where id=@uid)
		if ((select passwd from student where id=@uid)=@pwd)
			select 1 status;
		else
			select 0 status;
	else if exists(select passwd from teacher where id=@uid)
		if ((select passwd from teacher where id=@uid)=@pwd)
			select 2 status;
		else
			select 0 status;
	else
		select 0 status;
/*********************调查项目管理*************************/
/******添加*******/
create proc addRankItem 
	@text varchar(255)
as
	insert into rank_items ([text]) values (@text);
GO
/******删除*******/
create proc deleteRankItem 
	@rid int
as
	delete from rank_items where id=@rid;
GO
/******修改*******/
create proc updateRankItem
	@rid int,
	@text varchar(255)
as
	update rank_items set [text]=@text where id=@rid;
GO
/******查询*******/
create proc getRankItems
as
	select * from rank_items;
GO

/*********************学生的功能*************************/
/******查询所选课程*******/
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
/******评论所选课程*******/
create proc commitCourse 
	@committer_id int,
	@course_id int,
	@text varchar(255)=''
as
	if exists(select * from [commit] where committer_id=@committer_id AND course_id=@course_id)
		UPDATE [commit] SET committer_id=@committer_id,course_id=@course_id,commit_text=@text
			WHERE committer_id=@committer_id AND course_id=@course_id
	else
		insert into [commit] (committer_id,course_id,commit_text) values (@committer_id,@course_id,@text);
GO
/******添加评级*******/
create proc [addRank] 
	@sid int,
	@cid int,
	@items_id int,
	@rank int
as
	declare @commit_id int;
	select @commit_id=id from [commit] where committer_id=@sid AND course_id=@cid;
	if exists(select * from [ranks] where commit_id=@commit_id AND items_id=@items_id)
		UPDATE [ranks] SET commit_id=@commit_id,items_id=@items_id,[rank]=@rank
			WHERE commit_id=@commit_id AND items_id=@items_id
	else
		insert into [ranks] (commit_id,items_id,[rank]) values (@commit_id,@items_id,@rank);
/*********************教师的功能*************************/
/******查询所教课程*******/
create proc getCourseByteacherid 
	@tid int
as
	select course.id,course.name 
	from course  
	where teacher_id=@tid;
GO
/******查询文字评价*******/
create proc getcommitByCourseId
	@cid int
as
	select [commit_text] from [commit] where course_id=@cid;
GO
/********查询评级*********/
create proc getRankCountByCourseId
	@cid int
as
	select [rank],count([rank]) as 'count' from [commit] join ranks on [commit].id=ranks.commit_id where course_id=@cid group by [rank];
GO
