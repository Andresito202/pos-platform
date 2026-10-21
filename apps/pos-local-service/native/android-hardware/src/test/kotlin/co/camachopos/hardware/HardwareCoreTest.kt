package co.camachopos.hardware

import kotlin.test.*
class HardwareCoreTest {
    private class Ledger : HardwareLedger {
        val records = mutableMapOf<String, Pair<String, JobState>>()
        override fun claim(intent: HardwareIntent): Boolean {
            val prior = records[intent.jobId]
            if (prior != null) { require(prior.first == intent.checksum); return false }
            records[intent.jobId] = intent.checksum to JobState.DISPATCHING; return true
        }
        override fun finish(jobId: String, state: JobState) { records[jobId] = records.getValue(jobId).first to state }
        override fun state(jobId: String) = records[jobId]?.second
    }
    private val intent = HardwareIntent("fixture-job", "a".repeat(64), JobKind.DRAWER_OPEN, "Authorized JVM test")
    @Test fun deniedAuthorizationNeverReachesTransport() {
        var writes = 0
        val bridge = AuthorizedHardwareBridge({ null }, Ledger()) { writes++; JobState.TRANSPORT_ACCEPTED }
        assertNull(bridge.execute(intent)); assertEquals(0, writes)
    }
    @Test fun duplicateJobDoesNotEmitAnotherPulse() {
        var writes = 0
        val bridge = AuthorizedHardwareBridge({ AuthorizedJob(it, byteArrayOf(1)) }, Ledger()) { writes++; JobState.TRANSPORT_ACCEPTED }
        assertEquals(JobState.TRANSPORT_ACCEPTED, bridge.execute(intent)); bridge.execute(intent); assertEquals(1, writes)
    }
    @Test fun uncertainOutcomeDoesNotRetry() {
        var writes = 0
        val bridge = AuthorizedHardwareBridge({ AuthorizedJob(it, byteArrayOf(1)) }, Ledger()) { writes++; throw IllegalStateException("disconnected") }
        assertEquals(JobState.UNKNOWN, bridge.execute(intent)); assertEquals(JobState.UNKNOWN, bridge.execute(intent)); assertEquals(1, writes)
    }
    @Test fun alteredJobIdentityFailsClosed() {
        val bridge = AuthorizedHardwareBridge({ AuthorizedJob(it.copy(jobId="other"), byteArrayOf(1)) }, Ledger()) { error("must not write") }
        assertFails { bridge.execute(intent) }
    }
    @Test fun interruptedDispatchDoesNotReplay() {
        val ledger = Ledger(); ledger.claim(intent)
        val bridge = AuthorizedHardwareBridge({ AuthorizedJob(it, byteArrayOf(1)) }, ledger) { error("must not write") }
        assertEquals(JobState.DISPATCHING, bridge.execute(intent))
    }
}
