import com.android.apksig.ApkSigner;
import com.android.apksig.ApkVerifier;
import java.io.File;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

public final class CommercialApkSigner {
    private static char[] password(String name) {
        String value = System.getenv(name);
        if (value == null || value.isEmpty()) throw new IllegalArgumentException("MISSING_RELEASE_CREDENTIAL");
        return value.toCharArray();
    }
    private static String digest(X509Certificate certificate) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded());
        StringBuilder out = new StringBuilder();
        for (byte b : bytes) out.append(String.format(Locale.ROOT, "%02x", b & 255));
        return out.toString();
    }
    public static void main(String[] args) throws Exception {
        if (args.length != 5) throw new IllegalArgumentException("RELEASE_SIGNER_ARGUMENTS");
        String expected = args[2].replace(":", "").toLowerCase(Locale.ROOT);
        if (!expected.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("RELEASE_CERT_PIN_REQUIRED");
        File output = new File(args[4]);
        File temporary = new File(args[4] + ".partial");
        if (output.exists() || temporary.exists()) throw new IllegalStateException("RELEASE_OUTPUT_EXISTS");
        char[] storePassword = password("CAMACHO_ANDROID_RELEASE_STORE_PASSWORD");
        char[] keyPassword = password("CAMACHO_ANDROID_RELEASE_KEY_PASSWORD");
        try {
            KeyStore store = KeyStore.getInstance("PKCS12");
            try (InputStream stream = Files.newInputStream(new File(args[0]).toPath())) {
                store.load(stream, storePassword);
            }
            if (!store.isKeyEntry(args[1])) throw new IllegalArgumentException("RELEASE_KEY_ENTRY_REQUIRED");
            PrivateKey key = (PrivateKey) store.getKey(args[1], keyPassword);
            Certificate[] chain = store.getCertificateChain(args[1]);
            if (key == null || chain == null || chain.length == 0) throw new IllegalArgumentException("RELEASE_KEY_CHAIN_REQUIRED");
            List<X509Certificate> certs = new ArrayList<>();
            for (Certificate certificate : chain) certs.add((X509Certificate) certificate);
            certs.get(0).checkValidity();
            if (!digest(certs.get(0)).equals(expected)) throw new SecurityException("RELEASE_CERT_PIN_MISMATCH");
            ApkSigner.SignerConfig config = new ApkSigner.SignerConfig.Builder("camacho-release", key, certs).build();
            new ApkSigner.Builder(Arrays.asList(config))
                .setInputApk(new File(args[3])).setOutputApk(temporary)
                .setMinSdkVersion(28).setV1SigningEnabled(false).setV2SigningEnabled(true)
                .setV3SigningEnabled(true).setV4SigningEnabled(false).build().sign();
            ApkVerifier.Result result = new ApkVerifier.Builder(temporary).setMinCheckedPlatformVersion(28).build().verify();
            if (!result.isVerified() || !result.isVerifiedUsingV2Scheme() || result.getSignerCertificates().size()!=1
                || !digest(result.getSignerCertificates().get(0)).equals(expected)) throw new SecurityException("RELEASE_SIGNATURE_VERIFICATION_FAILED");
            Files.move(temporary.toPath(), output.toPath(), StandardCopyOption.ATOMIC_MOVE);
            System.out.println("RELEASE_CERT_SHA256=" + expected);
        } finally {
            Arrays.fill(storePassword, '\0');
            Arrays.fill(keyPassword, '\0');
            Files.deleteIfExists(temporary.toPath());
        }
    }
}
