import com.android.apksig.ApkSigner;
import com.android.apksig.ApkVerifier;
import java.io.File;
import java.nio.file.Files;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.HexFormat;
import java.util.List;

/** Laboratory APK signing only; reads password from process environment, never logs it. */
public final class SignApk {
    public static void main(String[] args) throws Exception {
        char[] password = System.getenv("CAMACHO_LAB_APK_PASSWORD").toCharArray();
        KeyStore store = KeyStore.getInstance("PKCS12");
        try (var input = Files.newInputStream(new File(args[0]).toPath())) { store.load(input,password); }
        var cert = (X509Certificate)store.getCertificate("hardware-lab");
        var key = (PrivateKey)store.getKey("hardware-lab",password);
        var signer = new ApkSigner.SignerConfig.Builder("hardware-lab",key,List.of(cert)).build();
        new ApkSigner.Builder(List.of(signer)).setInputApk(new File(args[1])).setOutputApk(new File(args[2]))
            .setMinSdkVersion(28).setV1SigningEnabled(true).setV2SigningEnabled(true).setV3SigningEnabled(false).build().sign();
        var result = new ApkVerifier.Builder(new File(args[2])).setMinCheckedPlatformVersion(28).build().verify();
        if (!result.isVerified() || !result.isVerifiedUsingV2Scheme()) throw new IllegalStateException("APK_VERIFICATION_FAILED: "+result.getErrors());
        System.out.println("APK_VERIFIED minSdk=28 v1="+result.isVerifiedUsingV1Scheme()+" v2="+result.isVerifiedUsingV2Scheme());
        System.out.println("APK_CERT_SHA256="+HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(cert.getEncoded())));
        java.util.Arrays.fill(password,'\0');
    }
}
