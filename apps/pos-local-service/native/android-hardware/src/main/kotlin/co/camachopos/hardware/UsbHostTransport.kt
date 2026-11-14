package co.camachopos.hardware

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbManager

/** Exact VID/PID/interface/endpoint from an approved physical device profile. No defaults. */
data class UsbPrinterProfile(val vendorId: Int, val productId: Int, val interfaceIndex: Int, val endpointAddress: Int, val timeoutMs: Int,
    val expectedDeviceName: String? = null, val expectedDescriptorSha256: String? = null)
data class UsbPeripheral(val deviceName: String, val vendorId: Int, val productId: Int, val permissionGranted: Boolean)
class UsbHostTransport(private val context: Context, private val profile: UsbPrinterProfile) : ByteTransport {
    private val manager = context.getSystemService(Context.USB_SERVICE) as UsbManager
    fun discover(): List<UsbPeripheral> = manager.deviceList.values.map {
        UsbPeripheral(it.deviceName, it.vendorId, it.productId, manager.hasPermission(it))
    }
    /** Invoked explicitly from the trusted native UI; OS displays the permission dialog. */
    fun requestPermission(deviceName: String) {
        val device = manager.deviceList[deviceName] ?: error("USB_DEVICE_NOT_PRESENT")
        require(device.vendorId == profile.vendorId && device.productId == profile.productId)
        val intent = Intent(context.packageName + ".USB_PERMISSION").setPackage(context.packageName)
        manager.requestPermission(device, PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT))
    }
    override fun send(bytes: ByteArray): JobState {
        require(profile.timeoutMs in 100..30000)
        val matches = manager.deviceList.values.filter { it.vendorId == profile.vendorId && it.productId == profile.productId }
        if (matches.size != 1) return JobState.FAILED // Do not choose between identical printers silently.
        val device = matches.single()
        if (profile.expectedDeviceName != null && device.deviceName != profile.expectedDeviceName) return JobState.FAILED
        if (!manager.hasPermission(device) || profile.interfaceIndex !in 0 until device.interfaceCount) return JobState.FAILED
        val usbInterface = device.getInterface(profile.interfaceIndex)
        val endpoint = (0 until usbInterface.endpointCount).map { usbInterface.getEndpoint(it) }.singleOrNull {
            it.address == profile.endpointAddress && it.direction == UsbConstants.USB_DIR_OUT && it.type == UsbConstants.USB_ENDPOINT_XFER_BULK
        } ?: return JobState.FAILED
        val connection = manager.openDevice(device) ?: return JobState.FAILED
        try {
            if (profile.expectedDescriptorSha256 != null && LabAuthorization.sha256(connection.rawDescriptors) != profile.expectedDescriptorSha256) return JobState.FAILED
            if (!connection.claimInterface(usbInterface, false)) return JobState.FAILED
            var offset = 0
            while (offset < bytes.size) {
                val size = minOf(16384, bytes.size - offset)
                val sent = connection.bulkTransfer(endpoint, bytes, offset, size, profile.timeoutMs)
                if (sent <= 0) return JobState.UNKNOWN
                offset += sent
            }
            // No paper sensor, physical print or drawer status inferred here.
            return JobState.TRANSPORT_ACCEPTED
        } finally { connection.releaseInterface(usbInterface); connection.close() }
    }
}
