from flask import Flask, render_template, request
from werkzeug.middleware.proxy_fix import ProxyFix

app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/cv")
def cv():
    return render_template("cv.html")

@app.route("/naninha")
def naninha():
    return render_template("naninha.html")

@app.context_processor
def inject_current_path():
    return dict(current_path=request.path)

if __name__ == "__main__":
    app.run(host="0.0.0.0", debug=True)
