package pl.miskibin.wormsy

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothServerSocket
import android.bluetooth.BluetoothSocket
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ArrayAdapter
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.BufferedWriter
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** WebView with packaged assets; only the local app origin can speak to the Bluetooth bridge. */
class MainActivity : Activity() {
    private val origin = "https://appassets.androidplatform.net"
    private val serviceId = UUID.fromString("6fac7d70-bb8e-4ea3-a529-79b60b4fc4db")
    private lateinit var web: WebView
    private val bluetooth: BluetoothAdapter? by lazy {
        (getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
    }
    @Volatile private var socket: BluetoothSocket? = null
    @Volatile private var server: BluetoothServerSocket? = null
    @Volatile private var writer: BufferedWriter? = null
    @Volatile private var generation = 0
    private val sendExecutor = Executors.newSingleThreadExecutor()
    private val snapshotPending = AtomicBoolean(false)
    private var pendingOp = ""
    private var picker: AlertDialog? = null
    private var pickerAdapter: ArrayAdapter<String>? = null
    private val found = mutableListOf<BluetoothDevice>()
    private var receiverRegistered = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private var reconnectTask: Runnable? = null
    private var rememberedDevice: BluetoothDevice? = null
    private var reconnectAttempts = 0

    private val discovery = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == BluetoothDevice.ACTION_FOUND) {
                val device = if (Build.VERSION.SDK_INT >= 33)
                    intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
                else @Suppress("DEPRECATION") intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                if (device != null) addDevice(device)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        web = WebView(this)
        web.setBackgroundColor(0xff101c26.toInt())
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        web.settings.javaScriptCanOpenWindowsAutomatically = false
        web.overScrollMode = View.OVER_SCROLL_NEVER
        setContentView(web)

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                if (request.url.host == "appassets.androidplatform.net") loader.shouldInterceptRequest(request.url) else null

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.url.host != "appassets.androidplatform.net"
        }
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            AlertDialog.Builder(this).setMessage("Zaktualizuj Android System WebView, aby uruchomić grę.")
                .setPositiveButton("OK", null).show()
            return
        }
        WebViewCompat.addWebMessageListener(web, "WormsBluetooth", setOf(origin)) {
                _, message, sourceOrigin, isMainFrame, _ ->
            if (isMainFrame && sourceOrigin == Uri.parse(origin) && message.data != null) {
                runOnUiThread { handleJs(message.data!!) }
            }
        }
        web.loadUrl("$origin/assets/www/index.html")
    }

    private fun handleJs(text: String) {
        if (text.length > 2_000_000) return
        val msg = try { JSONObject(text) } catch (_: Exception) { return }
        when (msg.optString("op")) {
            "host", "join" -> startNative(msg.getString("op"))
            "send" -> sendPacket(msg.optString("data"))
            "stop" -> { rememberedDevice = null; stopBluetooth() }
        }
    }

    private fun emit(type: String, data: String? = null) {
        val payload = JSONObject().put("type", type)
        if (data != null) payload.put("data", data)
        runOnUiThread {
            if (!isFinishing) web.evaluateJavascript(
                "window.__wormsBluetooth?.onNative(${JSONObject.quote(payload.toString())})", null
            )
        }
    }

    private fun startNative(op: String) {
        pendingOp = op
        rememberedDevice = null
        val adapter = bluetooth ?: run { emit("error", "Ten telefon nie ma Bluetooth."); return }
        val permissions = if (Build.VERSION.SDK_INT >= 31) {
            if (op == "host") arrayOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_ADVERTISE)
            else arrayOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN)
        } else if (op == "join") arrayOf(Manifest.permission.ACCESS_FINE_LOCATION) else emptyArray()
        val missing = permissions.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) { requestPermissions(missing.toTypedArray(), 101); return }
        try {
            if (!adapter.isEnabled) {
                @Suppress("DEPRECATION")
                startActivityForResult(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), 102)
                return
            }
            if (op == "host") {
                @Suppress("DEPRECATION")
                startActivityForResult(Intent(BluetoothAdapter.ACTION_REQUEST_DISCOVERABLE)
                    .putExtra(BluetoothAdapter.EXTRA_DISCOVERABLE_DURATION, 300), 103)
            } else pickDevice(adapter)
        } catch (_: SecurityException) { emit("error", "Zezwól aplikacji na dostęp do Bluetooth.") }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 101) {
            if (grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }) startNative(pendingOp)
            else emit("error", "Bluetooth wymaga zgody na urządzenia w pobliżu.")
        }
    }

    @Deprecated("System Bluetooth uses activity results on supported Android versions")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == 102) {
            if (resultCode == RESULT_OK) startNative(pendingOp) else emit("error", "Włącz Bluetooth, żeby grać bez internetu.")
        } else if (requestCode == 103) {
            if (resultCode > 0) listen() else emit("error", "Włącz widoczność telefonu, aby drugi gracz mógł go znaleźć.")
        }
    }

    private fun addDevice(device: BluetoothDevice) {
        if (found.any { it.address == device.address }) return
        found.add(device)
        val name = try { device.name ?: "Telefon" } catch (_: SecurityException) { "Telefon" }
        pickerAdapter?.add("$name (${device.address.takeLast(5)})")
    }

    private fun pickDevice(adapter: BluetoothAdapter) {
        stopBluetooth()
        found.clear()
        pickerAdapter = ArrayAdapter(this, android.R.layout.simple_list_item_1, mutableListOf<String>())
        val list = pickerAdapter!!
        try {
            adapter.bondedDevices?.forEach { addDevice(it) }
            val filter = IntentFilter(BluetoothDevice.ACTION_FOUND)
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(discovery, filter, Context.RECEIVER_EXPORTED)
            else registerReceiver(discovery, filter)
            receiverRegistered = true
            adapter.startDiscovery()
        } catch (_: SecurityException) { emit("error", "Zezwól na wyszukiwanie urządzeń Bluetooth."); return }
        picker = AlertDialog.Builder(this).setTitle("Wybierz telefon gospodarza")
            .setMessage("Na drugim telefonie wybierz Bluetooth → Stwórz pokój. Wyszukiwanie może potrwać kilka sekund.")
            .setAdapter(list) { _, position ->
                val device = found.getOrNull(position)
                stopDiscovery()
                if (device != null) connectTo(device)
            }
            .setNegativeButton("Anuluj") { _, _ -> stopDiscovery(); emit("error", "Nie wybrano telefonu.") }
            .create()
        picker?.show()
    }

    private fun stopDiscovery() {
        try { if (receiverRegistered) unregisterReceiver(discovery) } catch (_: Exception) { }
        receiverRegistered = false
        try { bluetooth?.cancelDiscovery() } catch (_: SecurityException) { }
        picker = null
        pickerAdapter = null
    }

    private fun listen() {
        stopBluetooth()
        val id = generation
        Thread {
            try {
                val listening = bluetooth!!.listenUsingRfcommWithServiceRecord("Wormsy", serviceId)
                server = listening
                emit("listening")
                while (generation == id) {
                    val incoming = listening.accept()
                    if (generation != id) { incoming.close(); break }
                    readConnection(incoming, id)
                }
            } catch (_: Exception) {
                if (generation == id) emit("error", "Bluetooth przestał nasłuchiwać. Utwórz pokój ponownie.")
            }
        }.apply { name = "worms-bt-host"; isDaemon = true }.start()
    }

    private fun connectTo(device: BluetoothDevice, retry: Boolean = false) {
        stopBluetooth()
        rememberedDevice = device
        val id = generation
        Thread {
            try {
                val outgoing = device.createRfcommSocketToServiceRecord(serviceId)
                socket = outgoing
                outgoing.connect()
                if (generation == id) readConnection(outgoing, id) else outgoing.close()
            } catch (_: Exception) {
                if (generation == id) {
                    if (retry) scheduleReconnect(id)
                    else {
                        rememberedDevice = null
                        emit("error", "Nie udało się połączyć. Spróbuj wybrać telefon ponownie.")
                    }
                }
            }
        }.apply { name = "worms-bt-guest"; isDaemon = true }.start()
    }

    private fun readConnection(link: BluetoothSocket, id: Int) {
        socket = link
        writer = link.outputStream.bufferedWriter(Charsets.UTF_8)
        reconnectAttempts = 0
        emit("connected")
        try {
            link.inputStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                for (line in lines) {
                    if (generation != id) break
                    if (line.length <= 2_000_000) emit("message", line)
                }
            }
        } catch (_: Exception) { /* po zamknięciu strumienia wracamy do nasłuchiwania */ }
        finally {
            if (generation == id && socket === link) {
                socket = null
                writer = null
                try { link.close() } catch (_: Exception) { }
                emit("disconnected")
                if (rememberedDevice != null) scheduleReconnect(id)
            }
        }
    }

    private fun scheduleReconnect(id: Int) {
        val device = rememberedDevice ?: return
        val delay = (500L shl reconnectAttempts.coerceAtMost(4)).coerceAtMost(8000L)
        reconnectAttempts++
        val task = Runnable {
            if (generation == id && rememberedDevice === device && !isFinishing) connectTo(device, true)
        }
        mainHandler.postDelayed(task, delay)
        reconnectTask = task
    }

    private fun sendPacket(packet: String) {
        if (packet.length > 2_000_000) return
        val snapshot = packet.contains("\"t\":\"snapshot\"")
        if (snapshot && !snapshotPending.compareAndSet(false, true)) return
        val link = socket
        sendExecutor.execute {
            try {
                if (link != null && link === socket) {
                    synchronized(link) {
                        writer?.write(packet)
                        writer?.newLine()
                        writer?.flush()
                    }
                }
            } catch (_: Exception) { try { link?.close() } catch (_: Exception) { } }
            finally { if (snapshot) snapshotPending.set(false) }
        }
    }

    private fun stopBluetooth() {
        generation++
        reconnectTask?.let { mainHandler.removeCallbacks(it) }
        reconnectTask = null
        picker?.dismiss()
        stopDiscovery()
        try { socket?.close() } catch (_: Exception) { }
        try { server?.close() } catch (_: Exception) { }
        socket = null
        server = null
        writer = null
        snapshotPending.set(false)
    }

    override fun onDestroy() {
        stopBluetooth()
        sendExecutor.shutdownNow()
        web.destroy()
        super.onDestroy()
    }
}
