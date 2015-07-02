/*action!!!
与ndm文件导出的区别：
1.course表的id属性有自增（INDENTITY（1，1））*/

CREATE TABLE [teacher] (

[id] int NOT NULL,

[name] varchar(255) NOT NULL,

[passwd] varchar(255) NOT NULL,

PRIMARY KEY ([id]) 

)

GO

CREATE TABLE [class] (

[id] int NOT NULL,

PRIMARY KEY ([id]) 

)

GO

CREATE TABLE [commit] (

[id] int NOT NULL,

[committer_id] int NOT NULL,

[course_id] int NOT NULL,

[commit_text] varchar(255) NOT NULL,

CONSTRAINT [IX_commit] UNIQUE NONCLUSTERED ([committer_id],[course_id]

),

PRIMARY KEY ([committer_id], [course_id], [id]) 

)

GO

CREATE TABLE [course] (

[id] int IDENTITY(1,1) NOT NULL,

[name] varchar(50) NOT NULL,

[teacher_id] int NOT NULL,

PRIMARY KEY ([id]) 

)

GO

CREATE TABLE [major] (

[class_id] int NOT NULL,

[course_id] int NOT NULL,

PRIMARY KEY ([class_id], [course_id]) 

)

GO



CREATE TABLE [student] (

[id] int NOT NULL,

[class_id] int NOT NULL,

[name] varchar(255) NOT NULL,

[passwd] varchar(255) NOT NULL,

PRIMARY KEY ([id]) 

)

GO

CREATE TABLE [extra] (

[student_id] int NOT NULL,

[course_id] int NOT NULL,

PRIMARY KEY ([student_id], [course_id]) 

)

GO



CREATE TABLE [ranks] (

[commit_id] int NOT NULL,

[items_id] int NOT NULL,

[rank] tinyint NOT NULL,

PRIMARY KEY ([items_id], [commit_id]) 

)

GO



CREATE TABLE [rank_items] (

[id] int NOT NULL,

[text] varchar(255) NOT NULL,

PRIMARY KEY ([id]) 

)

GO


ALTER TABLE [commit] ADD CONSTRAINT [fk_commit_course_2] FOREIGN KEY ([course_id]) REFERENCES [course] ([id])

GO

ALTER TABLE [major] ADD CONSTRAINT [fk_cl_co_class_1] FOREIGN KEY ([class_id]) REFERENCES [class] ([id])

GO

ALTER TABLE [major] ADD CONSTRAINT [fk_cl_co_course_1] FOREIGN KEY ([course_id]) REFERENCES [course] ([id])

GO

ALTER TABLE [course] ADD CONSTRAINT [fk_course_account_1] FOREIGN KEY ([teacher_id]) REFERENCES [teacher] ([id])

GO

ALTER TABLE [student] ADD CONSTRAINT [fk_student_class_1] FOREIGN KEY ([class_id]) REFERENCES [class] ([id])

GO

ALTER TABLE [extra] ADD CONSTRAINT [fk_extra_student_1] FOREIGN KEY ([student_id]) REFERENCES [student] ([id])

GO

ALTER TABLE [extra] ADD CONSTRAINT [fk_extra_course_1] FOREIGN KEY ([course_id]) REFERENCES [course] ([id])

GO

ALTER TABLE [commit] ADD CONSTRAINT [fk_commit_student_1] FOREIGN KEY ([committer_id]) REFERENCES [student] ([id])

GO

ALTER TABLE [ranks] ADD CONSTRAINT [fk_ranks_commit_1] FOREIGN KEY ([commit_id]) REFERENCES [commit] ([id])

GO

ALTER TABLE [ranks] ADD CONSTRAINT [fk_ranks_items_1] FOREIGN KEY ([items_id]) REFERENCES [rank_items] ([id])

GO



