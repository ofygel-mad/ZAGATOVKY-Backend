-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "costPrice" INTEGER;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "costPrice" INTEGER;

-- CreateIndex
CREATE INDEX "Order_archivedAt_idx" ON "Order"("archivedAt");
