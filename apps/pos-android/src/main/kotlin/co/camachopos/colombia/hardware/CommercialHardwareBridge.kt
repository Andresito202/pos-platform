package co.camachopos.colombia.hardware

import android.content.Context
import co.camachopos.hardware.UsbHostTransport
import co.camachopos.hardware.UsbPeripheral
import co.camachopos.hardware.UsbPrinterProfile

/**
 * Reuses the existing android-hardware UsbHostTransport for discovery and
 * permission. PRINT/DRAWER bytes still require signed HardwareAuthorizationVerifier
 * jobs from Local Service — this bridge never grants authority from the UI.
 */
class CommercialHardwareBridge(private val context: Context) {
    private val printerTransport = UsbHostTransport(
        context,
        UsbPrinterProfile(
            vendorId = HardwareSurfaceGate.GPRINTER_VENDOR_ID,
            productId = HardwareSurfaceGate.GPRINTER_PRODUCT_ID,
            interfaceIndex = 0,
            endpointAddress = 0x01,
            timeoutMs = 5000,
        ),
    )

    private val scaleTransport = UsbHostTransport(
        context,
        UsbPrinterProfile(
            vendorId = HardwareSurfaceGate.CH340_VENDOR_ID,
            productId = HardwareSurfaceGate.CH340_PRODUCT_ID,
            interfaceIndex = 0,
            endpointAddress = 0x02,
            timeoutMs = 2000,
        ),
    )

    fun discover(): List<UsbPeripheral> {
        val seen = linkedMapOf<String, UsbPeripheral>()
        printerTransport.discover().forEach { seen[it.deviceName] = it }
        scaleTransport.discover().forEach { seen[it.deviceName] = it }
        return seen.values.toList()
    }

    fun requestPermission(deviceName: String) {
        val peripheral = discover().firstOrNull { it.deviceName == deviceName }
            ?: error("USB_DEVICE_NOT_PRESENT")
        when (HardwareSurfaceGate.classify(peripheral.vendorId, peripheral.productId)) {
            HardwareSurfaceGate.SCALE_CAPABILITY -> scaleTransport.requestPermission(deviceName)
            else -> printerTransport.requestPermission(deviceName)
        }
    }
}
