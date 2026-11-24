package co.camachopos.hardware

enum class JobKind { PRINT, DRAWER_OPEN }
enum class JobState { DISPATCHING, TRANSPORT_ACCEPTED, FAILED, UNKNOWN }
data class HardwareIntent(val jobId: String, val checksum: String, val kind: JobKind, val reason: String)
data class AuthorizedJob(val intent: HardwareIntent, val bytes: ByteArray)

/** Host must verify the canonical session, scope, permission and integrity.
 * No implementation grants authority from a boolean sent by a WebView.
 * The app host/provisioning integration is mandatory and deliberately absent.
 */
fun interface HardwareAuthorizationVerifier { fun verify(intent: HardwareIntent): AuthorizedJob? }
interface HardwareLedger {
    fun claim(intent: HardwareIntent): Boolean
    fun finish(jobId: String, state: JobState)
    fun state(jobId: String): JobState?
}
fun interface ByteTransport { fun send(bytes: ByteArray): JobState }
class AuthorizedHardwareBridge(
    private val authorization: HardwareAuthorizationVerifier,
    private val ledger: HardwareLedger,
    private val transport: ByteTransport
) {
    @Synchronized fun execute(intent: HardwareIntent): JobState? {
        require(intent.reason.trim().isNotEmpty())
        val verified = authorization.verify(intent) ?: return null
        require(verified.intent == intent) { "HARDWARE_AUTHORIZATION_BINDING_MISMATCH" }
        if (!ledger.claim(intent)) return ledger.state(intent.jobId)
        val outcome = try { transport.send(verified.bytes) } catch (_: Exception) { JobState.UNKNOWN }
        // If this persistence fails, DISPATCHING survives and restart converts it to UNKNOWN.
        ledger.finish(intent.jobId, outcome)
        return outcome
    }
}
