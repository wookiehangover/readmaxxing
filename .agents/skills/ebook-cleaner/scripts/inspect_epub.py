#!/usr/bin/env python3
import json
import posixpath
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

OPF = "http://www.idpf.org/2007/opf"
DC = "http://purl.org/dc/elements/1.1/"
CONTAINER = "urn:oasis:names:tc:opendocument:xmlns:container"


def q(ns, name):
    return f"{{{ns}}}{name}"


def text(el):
    return "" if el is None or el.text is None else " ".join(el.text.split())


def find_package(zf):
    root = ET.fromstring(zf.read("META-INF/container.xml"))
    rootfile = root.find(f".//{q(CONTAINER, 'rootfile')}")
    if rootfile is None:
        raise SystemExit("No rootfile in META-INF/container.xml")
    return rootfile.attrib["full-path"]


def inspect(path):
    with zipfile.ZipFile(path) as zf:
        names = set(zf.namelist())
        package_path = find_package(zf)
        package_dir = posixpath.dirname(package_path)
        root = ET.fromstring(zf.read(package_path))
        metadata = root.find(q(OPF, "metadata"))
        manifest = root.find(q(OPF, "manifest"))
        spine = root.find(q(OPF, "spine"))
        items = list(manifest.findall(q(OPF, "item"))) if manifest is not None else []
        itemrefs = list(spine.findall(q(OPF, "itemref"))) if spine is not None else []

        hrefs = {item.attrib.get("id"): item.attrib.get("href") for item in items}
        media_types = {}
        properties = {}
        for item in items:
            href = item.attrib.get("href", "")
            media_types[href] = item.attrib.get("media-type", "")
            properties[href] = item.attrib.get("properties", "")

        xhtml_files = [name for name in names if name.endswith((".xhtml", ".html"))]
        css_files = [name for name in names if name.endswith(".css")]
        font_files = [name for name in names if name.lower().endswith((".ttf", ".otf", ".woff", ".woff2"))]
        image_files = [name for name in names if name.lower().endswith((".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp"))]
        nav_files = [posixpath.normpath(posixpath.join(package_dir, href)) for href, props in properties.items() if "nav" in props.split()]
        ncx_files = [name for name in names if name.endswith(".ncx")]

        css_remote_imports = []
        for css in css_files:
            data = zf.read(css).decode("utf-8", errors="replace")
            if "http://" in data or "https://" in data:
                css_remote_imports.append(css)

        title = text(metadata.find(q(DC, "title"))) if metadata is not None else ""
        creator = text(metadata.find(q(DC, "creator"))) if metadata is not None else ""
        language = text(metadata.find(q(DC, "language"))) if metadata is not None else ""

        return {
            "file": str(path),
            "package_path": package_path,
            "epub_version": root.attrib.get("version"),
            "title": title,
            "creator": creator,
            "language": language,
            "manifest_count": len(items),
            "spine_count": len(itemrefs),
            "xhtml_count": len(xhtml_files),
            "image_count": len(image_files),
            "css_files": css_files,
            "font_files": font_files,
            "nav_files": nav_files,
            "ncx_files": ncx_files,
            "remote_css_files": css_remote_imports,
            "first_zip_member": zf.infolist()[0].filename if zf.infolist() else None,
            "mimetype_uncompressed": bool(zf.infolist() and zf.infolist()[0].filename == "mimetype" and zf.infolist()[0].compress_type == zipfile.ZIP_STORED),
        }


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: inspect_epub.py <book.epub>")
    print(json.dumps(inspect(Path(sys.argv[1])), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
