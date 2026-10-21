CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `verifiedAt` DATETIME(3) NULL,
    `verifyHash` VARCHAR(191) NULL,
    `verifyExpires` DATETIME(3) NULL,
    `verifyAttempts` INTEGER NOT NULL DEFAULT 0,
    `resetHash` VARCHAR(191) NULL,
    `resetExpires` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Account` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL DEFAULT 'Personal funds',
    `openingBalance` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `allowOverdraft` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `Account_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PaymentSchedule` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `recipient` VARCHAR(191) NULL,
    `dueDate` DATE NOT NULL,
    `category` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'scheduled',
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `PaymentSchedule_userId_dueDate_status_idx`(`userId`, `dueDate`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Transaction` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `counterparty` VARCHAR(191) NULL,
    `category` VARCHAR(191) NULL,
    `happenedAt` DATE NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'posted',
    `method` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `scheduleId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    UNIQUE INDEX `Transaction_scheduleId_key`(`scheduleId`),
    INDEX `Transaction_userId_happenedAt_deletedAt_idx`(`userId`, `happenedAt`, `deletedAt`),
    INDEX `Transaction_userId_kind_status_deletedAt_idx`(`userId`, `kind`, `status`, `deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ShareLink` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `fromDate` DATE NOT NULL,
    `toDate` DATE NOT NULL,
    `fields` JSON NOT NULL,
    `expiresAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `ShareLink_tokenHash_key`(`tokenHash`),
    INDEX `ShareLink_userId_revokedAt_idx`(`userId`, `revokedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `beforeData` JSON NULL,
    `afterData` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `AuditLog_userId_entityType_entityId_createdAt_idx`(`userId`, `entityType`, `entityId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Account` ADD CONSTRAINT `Account_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PaymentSchedule` ADD CONSTRAINT `PaymentSchedule_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `PaymentSchedule`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ShareLink` ADD CONSTRAINT `ShareLink_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
