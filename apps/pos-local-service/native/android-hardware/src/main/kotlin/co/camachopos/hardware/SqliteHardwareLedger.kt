package co.camachopos.hardware

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/** Receiver execution ledger only; no sales, payments, receipt amounts or second business engine. */
class SqliteHardwareLedger(context: Context) : SQLiteOpenHelper(context, "hardware-receiver.db", null, 1), HardwareLedger {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE hardware_jobs (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL)")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) { error("UNAPPROVED_HARDWARE_MIGRATION") }
    fun recoverInterrupted() { writableDatabase.execSQL("UPDATE hardware_jobs SET state='UNKNOWN' WHERE state='DISPATCHING'") }
    @Synchronized override fun claim(intent: HardwareIntent): Boolean {
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.rawQuery("SELECT checksum FROM hardware_jobs WHERE id=?", arrayOf(intent.jobId)).use {
                if (it.moveToFirst()) { require(it.getString(0) == intent.checksum) { "HARDWARE_IDEMPOTENCY_CONFLICT" }; return false }
            }
            db.execSQL("INSERT INTO hardware_jobs(id,checksum,kind,state) VALUES (?,?,?,'DISPATCHING')", arrayOf(intent.jobId, intent.checksum, intent.kind.name))
            db.setTransactionSuccessful(); return true
        } finally { db.endTransaction() }
    }
    @Synchronized override fun finish(jobId: String, state: JobState) {
        val values = android.content.ContentValues().apply { put("state", state.name) }
        require(writableDatabase.update("hardware_jobs", values, "id=? AND state='DISPATCHING'", arrayOf(jobId)) == 1)
    }
    override fun state(jobId: String): JobState? = readableDatabase.rawQuery("SELECT state FROM hardware_jobs WHERE id=?", arrayOf(jobId)).use {
        if (it.moveToFirst()) JobState.valueOf(it.getString(0)) else null
    }
}
