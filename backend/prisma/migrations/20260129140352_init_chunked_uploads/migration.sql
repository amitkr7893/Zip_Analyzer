-- CreateTable
CREATE TABLE `uploads` (
    `id` VARCHAR(191) NOT NULL,
    `filename` VARCHAR(191) NOT NULL,
    `total_size` BIGINT NOT NULL,
    `total_chunks` INTEGER NOT NULL,
    `status` ENUM('UPLOADING', 'PROCESSING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'UPLOADING',
    `final_hash` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chunks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `upload_id` VARCHAR(191) NOT NULL,
    `chunk_index` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'UPLOADED') NOT NULL DEFAULT 'PENDING',
    `received_at` DATETIME(3) NULL,

    UNIQUE INDEX `chunks_upload_id_chunk_index_key`(`upload_id`, `chunk_index`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `chunks` ADD CONSTRAINT `chunks_upload_id_fkey` FOREIGN KEY (`upload_id`) REFERENCES `uploads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
