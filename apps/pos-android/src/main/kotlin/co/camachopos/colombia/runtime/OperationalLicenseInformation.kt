package co.camachopos.colombia.runtime

/** Display DTO from the same-UID Service only. Cannot authorize sales. */
class OperationalLicenseInformation internal constructor(
    val status:String,val signedValidUntil:String?=null,val lastAcceptedLocalCheck:String?=null,val syncState:String="NOT_CONFIGURED"
) {
    companion object { fun unverified()=OperationalLicenseInformation("UNVERIFIED") }
    fun title()=when(status){"EXPIRED"->"Licencia vencida";"CURRENT"->"Licencia vigente";"SUSPENDED"->"Licencia suspendida";"REVOKED"->"Licencia revocada";else->"Licencia sin verificar"}
    fun message()=when(status){
        "EXPIRED"->"El acceso a nuevas ventas está suspendido. Renueva tu licencia en camachoposcolombia.com."
        "CURRENT"->"Vigente hasta: "+(signedValidUntil?:"sin vencimiento de uso")
        "SUSPENDED","REVOKED"->"Tu licencia no permite operar nuevas ventas."
        else->"No hay una licencia verificada en este dispositivo."
    }
    fun details()="Última validación: "+(lastAcceptedLocalCheck?:"no disponible")
}
