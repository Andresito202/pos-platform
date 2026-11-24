package co.camachopos.colombia.runtime

import org.json.JSONObject
import java.util.UUID

/** Thin binder client for Local Service IPC contracts. */
class PosClient(private val binder: LocalPosService.LocalBinder) {
    fun login(username: String, password: String, callback: (JSONObject) -> Unit) {
        request(
            "local.operator.login",
            JSONObject().put("username", username).put("password", password),
            callback,
        )
    }

    fun session(callback: (JSONObject) -> Unit) {
        request("local.operator.session", JSONObject(), callback)
    }

    fun logout(callback: (JSONObject) -> Unit) {
        request("local.operator.logout", JSONObject(), callback)
    }

    fun invoke(messageType: String, payload: JSONObject = JSONObject(), callback: (JSONObject) -> Unit) {
        request(messageType, payload, callback)
    }

    private fun request(messageType: String, payload: JSONObject, callback: (JSONObject) -> Unit) {
        val body = JSONObject()
            .put("protocol_version", "1.0.0")
            .put("message_type", messageType)
            .put("request_id", UUID.randomUUID().toString())
            .put("correlation_id", JSONObject.NULL)
            .put("payload", payload)
        binder.request(body, callback)
    }
}
