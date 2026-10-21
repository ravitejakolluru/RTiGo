CREATE TABLE `MonthlyReportDelivery` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `periodStart` DATE NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `attemptedAt` DATETIME(3) NULL,
    `sentAt` DATETIME(3) NULL,
    `lastError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `MonthlyReportDelivery_userId_periodStart_key`(`userId`, `periodStart`),
    INDEX `MonthlyReportDelivery_status_attemptedAt_idx`(`status`, `attemptedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `MonthlyReportDelivery` ADD CONSTRAINT `MonthlyReportDelivery_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
