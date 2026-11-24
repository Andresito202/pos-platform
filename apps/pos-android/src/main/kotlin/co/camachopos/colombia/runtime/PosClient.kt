package co.camachopos.colombia.runtime

import org.json.JSONObject
import java.util.UUID

/** Thin binder client for Local Service IPC contracts. BUSINESS sessions use
 * session.activate / session.recover — never local.operator.login. */
class PosClient(private val binder: LocalPosService.LocalBinder) {
    fun activateSession(sessionAssertion: JSONObject, callback: (JSONObject) -> Unit) {
        request(
            "session.activate",
            JSONObject().put("session_assertion", sessionAssertion),
            callback,
            idempotent = false,
        )
    }

    fun recoverSession(callback: (JSONObject) -> Unit) {
        request("session.recover", JSONObject(), callback, idempotent = false)
    }

    fun capabilities(callback: (JSONObject) -> Unit) {
        request("authorization.capabilities.get", JSONObject(), callback, idempotent = false)
    }

    fun invoke(
        messageType: String,
        payload: JSONObject = JSONObject(),
        idempotent: Boolean = false,
        callback: (JSONObject) -> Unit,
    ) {
        request(messageType, payload, callback, idempotent)
    }

    private fun request(
        messageType: String,
        payload: JSONObject,
        callback: (JSONObject) -> Unit,
        idempotent: Boolean,
    ) {
        val body = JSONObject()
            .put("protocol_version", "1.0.0")
            .put("message_type", messageType)
            .put("request_id", UUID.randomUUID().toString())
            .put("correlation_id", JSONObject.NULL)
            .put("payload", payload)
        if (idempotent) {
            body.put("operation_id", UUID.randomUUID().toString())
            body.put("idempotency_key", UUID.randomUUID().toString())
        }
        binder.request(body, callback)
    }
}
