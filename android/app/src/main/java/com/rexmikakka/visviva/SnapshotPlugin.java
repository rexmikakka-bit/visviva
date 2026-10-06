package com.rexmikakka.visviva;

import android.Manifest;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/**
 * Gets a snapshot PNG out of the WebView, which on Android cannot do it alone: the System WebView has
 * no Web Share API, ignores <a download> on a blob: URL, rejects image writes to navigator.clipboard,
 * and offers no "save image" on long-press. The snapshot sheet used every one of those, so on Android
 * both its buttons did nothing (and Save reported success anyway).
 *
 * saveToGallery — Pictures/Axis via MediaStore. Android 10+ needs no permission for an app's own
 *                 media; 7-9 need WRITE_EXTERNAL_STORAGE, requested here (manifest caps it at 28).
 * copyImage     — the image itself on the clipboard, as a FileProvider content URI. @capacitor/clipboard
 *                 cannot: its "image" option writes the data URL as PLAIN TEXT on Android. The
 *                 clipboard service grants the pasting app read access to the URI, which is what the
 *                 provider's grantUriPermissions="true" is for.
 *
 * Both take {data: base64 PNG without the data: prefix, filename}.
 */
@CapacitorPlugin(
    name = "AxisSnapshot",
    permissions = { @Permission(strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }, alias = "storage") }
)
public class SnapshotPlugin extends Plugin {

    private static final String ALBUM = "Axis";

    @PluginMethod
    public void saveToGallery(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storagePermissionDone");
            return;
        }
        doSave(call);
    }

    @PermissionCallback
    private void storagePermissionDone(PluginCall call) {
        if (getPermissionState("storage") == PermissionState.GRANTED) doSave(call);
        else call.reject("Storage permission was denied", "PERMISSION_DENIED");
    }

    private void doSave(PluginCall call) {
        byte[] png = decode(call);
        if (png == null) return;
        String name = filename(call);
        Context ctx = getContext();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver resolver = ctx.getContentResolver();
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + ALBUM);
                values.put(MediaStore.Images.Media.IS_PENDING, 1);
                Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new IOException("The gallery refused the image");
                try (OutputStream out = resolver.openOutputStream(uri)) {
                    if (out == null) throw new IOException("Could not open the gallery entry");
                    out.write(png);
                } catch (IOException e) {
                    resolver.delete(uri, null, null);   // never leave a half-written entry behind
                    throw e;
                }
                values.clear();
                values.put(MediaStore.Images.Media.IS_PENDING, 0);
                resolver.update(uri, values, null, null);
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), ALBUM);
                if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Could not create Pictures/" + ALBUM);
                File file = new File(dir, name);
                write(file, png);
                MediaScannerConnection.scanFile(ctx, new String[] { file.getAbsolutePath() }, new String[] { "image/png" }, null);
            }
            JSObject ret = new JSObject();
            ret.put("album", Environment.DIRECTORY_PICTURES + "/" + ALBUM);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Couldn't save to the gallery: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void copyImage(PluginCall call) {
        byte[] png = decode(call);
        if (png == null) return;
        Context ctx = getContext();
        try {
            // One reused file: a clipboard holds one image, so a new copy replaces the last.
            File dir = new File(ctx.getCacheDir(), "snapshot-clip");
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Could not create the cache folder");
            File file = new File(dir, "axis-snapshot.png");
            write(file, png);
            Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", file);
            ClipboardManager clipboard = (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
            if (clipboard == null) throw new IOException("No clipboard service");
            clipboard.setPrimaryClip(ClipData.newUri(ctx.getContentResolver(), filename(call), uri));
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't copy the image: " + e.getMessage(), e);
        }
    }

    private static byte[] decode(PluginCall call) {
        String data = call.getString("data");
        if (data == null || data.isEmpty()) {
            call.reject("No image data");
            return null;
        }
        try {
            return Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("Image data is not valid base64");
            return null;
        }
    }

    private static String filename(PluginCall call) {
        String name = call.getString("filename", "axis-snapshot.png");
        return name.toLowerCase().endsWith(".png") ? name : name + ".png";
    }

    private static void write(File file, byte[] png) throws IOException {
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(png);
        }
    }
}
