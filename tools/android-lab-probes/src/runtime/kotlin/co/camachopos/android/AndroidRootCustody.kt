package co.camachopos.android

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.File
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec

/** Laboratory candidate for SEC-004. Never loads or replaces an existing commercial identity. */
object AndroidRootCustody {
    private const val ALIAS="camacho.android.local-service.wrap.v1"
    private val MAGIC=byteArrayOf(67,80,82,49)
    data class Material(val root:ByteArray,val hardwareBacked:Boolean,val restored:Boolean)
    @Synchronized fun load(context:Context):Material {
        val directory=File(context.filesDir,"security").apply { check(isDirectory||mkdirs()) }
        val file=AtomicFile(File(directory,"android-root.v1.wrapped"))
        val keyStore=KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val exists=file.baseFile.exists()||File(file.baseFile.path+".bak").exists()
        val hasKey=keyStore.containsAlias(ALIAS)
        check(exists==hasKey) { "ANDROID_CUSTODY_INCOMPLETE_NO_AUTOMATIC_REPLACEMENT" }
        if(!exists) {
            check(directory.listFiles()?.none { it.name.endsWith(".secret") }==true) { "ANDROID_CUSTODY_ROOT_MISSING_WITH_SECRETS" }
            val generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore")
            generator.init(KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).setUserAuthenticationRequired(false).build())
            generator.generateKey()
        }
        val key=keyStore.getKey(ALIAS,null) as? SecretKey ?: error("ANDROID_CUSTODY_KEY_UNAVAILABLE")
        check(key.encoded==null) { "ANDROID_CUSTODY_WRAPPING_KEY_EXPORTABLE" }
        val info=SecretKeyFactory.getInstance(key.algorithm,"AndroidKeyStore").getKeySpec(key,KeyInfo::class.java) as KeyInfo
        val aad=("camacho.android.root.v1:"+context.packageName).toByteArray(Charsets.UTF_8)
        if(exists) {
            val envelope=file.openRead().use { it.readBytes() }
            check(envelope.size==64&&envelope.copyOfRange(0,4).contentEquals(MAGIC)) { "ANDROID_CUSTODY_ENVELOPE_REJECTED" }
            val cipher=Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE,key,GCMParameterSpec(128,envelope.copyOfRange(4,16)));cipher.updateAAD(aad)
            val root=cipher.doFinal(envelope.copyOfRange(16,64));check(root.size==32)
            return Material(root,info.isInsideSecureHardware,true)
        }
        val root=ByteArray(32).also { SecureRandom().nextBytes(it) }
        try {
            val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key);cipher.updateAAD(aad)
            check(cipher.iv.size==12)
            val envelope=MAGIC+cipher.iv+cipher.doFinal(root);check(envelope.size==64)
            val stream=file.startWrite()
            try { stream.write(envelope);file.finishWrite(stream) } catch(error:Exception){file.failWrite(stream);throw error}
            return Material(root,info.isInsideSecureHardware,false)
        } catch(error:Exception) { root.fill(0);throw error }
    }
}
