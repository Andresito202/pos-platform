package co.camachopos.android

/** Display DTO from the same-UID Service only. It cannot authorize sales,
 * change a contract, select a tenant or open a browser. */
class OperationalLicenseInformation internal constructor(
    val status:String,val signedValidUntil:String?=null,val lastAcceptedLocalCheck:String?=null,val syncState:String="NOT_CONFIGURED"
) {
    companion object { fun unverified()=OperationalLicenseInformation("UNVERIFIED") }
    fun title()=when(status){"EXPIRED"->"Licencia vencida";"CURRENT"->"Estado de licencia";"SUSPENDED"->"Licencia suspendida";"REVOKED"->"Licencia revocada";else->"Licencia sin verificar"}
    fun message()=when(status){
        "EXPIRED"->"El acceso a nuevas ventas está suspendido según las condiciones de tu licencia. La renovación se gestiona en camachoposcolombia.com."
        "CURRENT"->"Vigencia firmada: "+(signedValidUntil?:"sin vencimiento de uso")
        "SUSPENDED","REVOKED"->"Consulta el estado autorizado de tu licencia. No se modifican permisos ni contratos desde esta pantalla."
        else->"No existe un estado de licencia verificado disponible. No se habilitan nuevas ventas por mostrar esta pantalla."
    }
    fun details()="Última validación local aceptada: "+(lastAcceptedLocalCheck?:"no disponible")+
        "\nSincronización comercial: "+when(syncState){"SYNCED"->"comprobada";"OFFLINE"->"sin conexión";"NOT_CONFIGURED"->"sin aprovisionar";else->"sin verificar"}+
        "\nLa gracia se aplica según el derecho firmado; no se añaden días desde el dispositivo."
}
