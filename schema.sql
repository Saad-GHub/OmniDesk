-- db/schema.sql
IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'OmniDeskDB')
BEGIN
    CREATE DATABASE OmniDeskDB;
END
GO

USE OmniDeskDB;
GO

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Users' AND xtype='U')
BEGIN
    CREATE TABLE Users (
        UserID INT IDENTITY(1,1) PRIMARY KEY,
        Username VARCHAR(50) UNIQUE NOT NULL,
        PasswordHash VARCHAR(255) NOT NULL,
        Role VARCHAR(20) DEFAULT 'Employee',
        SlackAccessToken VARCHAR(255) NULL,
        ClickUpAccessToken VARCHAR(255) NULL,
        LinkedInAccessToken VARCHAR(255) NULL,
        CreatedAt DATETIME DEFAULT GETDATE()
    );
END
GO

IF NOT EXISTS (SELECT * FROM Users WHERE Username = 'saad_admin')
BEGIN
    INSERT INTO Users (Username, PasswordHash, Role) 
    VALUES ('saad_admin', 'workspace2026', 'Admin');
END
GO