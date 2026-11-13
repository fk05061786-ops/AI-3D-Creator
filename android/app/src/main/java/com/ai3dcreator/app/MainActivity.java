package com.ai3dcreator.app;

import android.os.Bundle;
import android.os.Environment;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.io.FileOutputStream;

/**
 * Hosts the web app and exposes a small download bridge so exported models
 * can be written to disk from the Android WebView. The JavaScript side looks
 * for window.AI3DSaveFile.saveFile(filename, base64, mime) and falls back to
 * a normal browser download when the bridge is missing.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = getBridge().getWebView();
        webView.addJavascriptInterface(new FileBridge(), "AI3DSaveFile");
    }

    public class FileBridge {

        @JavascriptInterface
        public void saveFile(String filename, String base64, String mime) {
            try {
                File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (dir == null) {
                    dir = getFilesDir();
                }
                if (!dir.exists()) {
                    dir.mkdirs();
                }
                File out = new File(dir, filename);
                byte[] data = Base64.decode(base64, Base64.DEFAULT);
                try (FileOutputStream stream = new FileOutputStream(out)) {
                    stream.write(data);
                }
                Toast.makeText(
                    MainActivity.this,
                    "Saved " + out.getAbsolutePath(),
                    Toast.LENGTH_LONG
                ).show();
            } catch (Exception error) {
                Toast.makeText(
                    MainActivity.this,
                    "Save failed: " + error.getMessage(),
                    Toast.LENGTH_LONG
                ).show();
            }
        }
    }
}
