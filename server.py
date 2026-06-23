#!/usr/bin/env python3
import os
import sys
import subprocess
import tempfile
from http.server import SimpleHTTPRequestHandler, HTTPServer

class CustomHandler(SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        # Handle CORS preflight
        self.send_response(200, "ok")
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header("Access-Control-Allow-Headers", "X-Requested-With, Content-Type")
        self.end_headers()

    def do_POST(self):
        if self.path == '/convert':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            print(f"[Server] Received conversion request. Data size: {content_length} bytes.")
            
            # Save the incoming video to a temporary file
            with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as temp_in:
                temp_in.write(post_data)
                temp_in_path = temp_in.name
                
            temp_out_path = temp_in_path + '_converted.mp4'
            
            try:
                # Run ffmpeg to convert to a standard, linearized H.264/AAC MP4
                # -movflags +faststart is crucial for web/mobile streaming and WhatsApp compatibility
                # -pix_fmt yuv420p is required for QuickTime and mobile players
                cmd = [
                    'ffmpeg', '-y',
                    '-i', temp_in_path,
                    '-c:v', 'libx264',
                    '-profile:v', 'main',
                    '-level:v', '4.0',
                    '-pix_fmt', 'yuv420p',
                    '-c:a', 'aac',
                    '-b:a', '192k',
                    '-movflags', '+faststart',
                    temp_out_path
                ]
                
                print(f"[Server] Running ffmpeg: {' '.join(cmd)}")
                result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                
                if result.returncode != 0:
                    raise Exception(f"ffmpeg error: {result.stderr}")
                
                # Read the converted MP4
                with open(temp_out_path, 'rb') as f:
                    converted_data = f.read()
                    
                # Send response
                self.send_response(200)
                self.send_header('Content-Type', 'video/mp4')
                self.send_header('Content-Length', str(len(converted_data)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(converted_data)
                print(f"[Server] Conversion successful! Sent {len(converted_data)} bytes of optimized MP4.")
                
            except Exception as e:
                print(f"[Server] Conversion failed: {e}")
                self.send_response(500)
                self.send_header('Content-Type', 'text/plain')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(str(e).encode('utf-8'))
                
            finally:
                # Clean up temp files
                if os.path.exists(temp_in_path):
                    try:
                        os.remove(temp_in_path)
                    except:
                        pass
                if os.path.exists(temp_out_path):
                    try:
                        os.remove(temp_out_path)
                    except:
                        pass
        else:
            self.send_response(404)
            self.end_headers()

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

def run(port=8000):
    # Serve files from the directory of this server script
    base_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(base_dir)
    server_address = ('', port)
    httpd = HTTPServer(server_address, CustomHandler)
    print(f"Starting custom server with ffmpeg conversion endpoint on port {port}...")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        httpd.server_close()

if __name__ == '__main__':
    port = 8000
    if len(sys.argv) > 1:
        port = int(sys.argv[1])
    run(port)
