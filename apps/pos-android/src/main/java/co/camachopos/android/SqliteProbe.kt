package co.camachopos.android

import android.app.Activity
import android.database.sqlite.SQLiteDatabase
import android.os.Bundle
import android.widget.ScrollView
import android.widget.TextView
import java.io.File

/** Isolated, noncommercial, offline SQLite persistence diagnostic for Android API 28+. */
class SqliteProbeActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val result = try { SqliteProbe(filesDir).run() } catch (e: Exception) {
            "FAILED: ${e.javaClass.simpleName}: ${e.message ?: "unknown"}"
        }
        val view = TextView(this)
        view.text = "CAMACHO POS - SQLITE PROBE\n\n$result\n\nNo sale or payment data was used."
        view.textSize = 17f
        view.setPadding(24, 36, 24, 24)
        setContentView(ScrollView(this).apply { addView(view) })
    }
}

internal class SqliteProbe(private val privateDir: File) {
    fun run(): String {
        val path = File(privateDir, "sqlite-probe-v1.db").absolutePath
        val first = SQLiteDatabase.openOrCreateDatabase(path, null)
        val checkpoint: Long
        try {
            first.execSQL("CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
            first.beginTransaction()
            try {
                first.execSQL("INSERT OR REPLACE INTO probe(id,value) VALUES (1,'persisted')")
                first.setTransactionSuccessful()
            } finally { first.endTransaction() }
            first.beginTransaction()
            try {
                first.execSQL("INSERT OR REPLACE INTO probe(id,value) VALUES (2,'must_rollback')")
                // Intentionally DO NOT mark successful: transaction must roll back.
            } finally { first.endTransaction() }
            first.rawQuery("SELECT COUNT(*) FROM probe WHERE id=2", null).use { cursor ->
                check(cursor.moveToFirst() && cursor.getLong(0) == 0L) { "ROLLBACK_FAILED" }
            }
            first.rawQuery("PRAGMA user_version", null).use { cursor ->
                check(cursor.moveToFirst()); checkpoint = cursor.getLong(0)
            }
        } finally { first.close() }
        val reopened = SQLiteDatabase.openDatabase(path, null, SQLiteDatabase.OPEN_READWRITE)
        try {
            reopened.rawQuery("SELECT value FROM probe WHERE id=1", null).use { cursor ->
                check(cursor.moveToFirst() && cursor.getString(0) == "persisted") { "REOPEN_FAILED" }
            }
            reopened.rawQuery("SELECT COUNT(*) FROM probe WHERE id=2", null).use { cursor ->
                check(cursor.moveToFirst() && cursor.getLong(0) == 0L) { "ROLLBACK_NOT_DURABLE" }
            }
        } finally { reopened.close() }
        return "PASS: WRITE / READ / ROLLBACK / CLOSE / REOPEN\nDB: private app files\nSchema user_version: $checkpoint\nData persists across activity restarts"
    }
}
