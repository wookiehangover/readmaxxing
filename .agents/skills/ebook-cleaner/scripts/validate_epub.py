#!/usr/bin/env python3
import posixpath
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

OPF = "http://www.idpf.org/2007/opf"
CONTAINER = "urn:oasis:names:tc:opendocument:xmlns:container"


def q(ns, name):
    return f"{{{ns}}}{name}"


def package_path(zf):
    try:
        root = ET.fromstring(zf.read("META-INF/container.xml"))
    except KeyError:
        return None, ["missing META-INF/container.xml"]
    except Exception as exc:
        return None, [f"META-INF/container.xml parse error: {exc}"]
    rootfile = root.find(f".//{q(CONTAINER, 'rootfile')}")
    if rootfile is None or not rootfile.attrib.get("full-path"):
        return None, ["missing rootfile full-path in container.xml"]
    return rootfile.attrib["full-path"], []


def validate(path):
    errors = []
    try:
        zf = zipfile.ZipFile(path)
    except Exception as exc:
        return [f"cannot open zip: {exc}"]

    with zf:
        infos = zf.infolist()
        names = set(zf.namelist())
        if not infos:
            errors.append("empty zip archive")
            return errors
        if infos[0].filename != "mimetype":
            errors.append("mimetype is not the first zip member")
        elif infos[0].compress_type != zipfile.ZIP_STORED:
            errors.append("mimetype is not stored without compression")
        try:
            if zf.read("mimetype") != b"application/epub+zip":
                errors.append("mimetype content is not application/epub+zip")
        except KeyError:
            errors.append("missing mimetype")

        opf_path, container_errors = package_path(zf)
        errors.extend(container_errors)
        if not opf_path:
            return errors
        if opf_path not in names:
            errors.append(f"package file missing: {opf_path}")
            return errors

        for name in sorted(names):
            if name.endswith((".xhtml", ".html", ".opf", ".xml", ".ncx")):
                try:
                    ET.fromstring(zf.read(name))
                except Exception as exc:
                    errors.append(f"{name}: XML parse error: {exc}")

        try:
            package = ET.fromstring(zf.read(opf_path))
        except Exception:
            return errors

        opf_dir = posixpath.dirname(opf_path)
        manifest = package.find(q(OPF, "manifest"))
        if manifest is None:
            errors.append("OPF missing manifest")
            return errors

        manifest_hrefs = set()
        nav_count = 0
        cover_image_count = 0
        for item in manifest.findall(q(OPF, "item")):
            href = item.attrib.get("href")
            if not href:
                errors.append("manifest item missing href")
                continue
            full = posixpath.normpath(posixpath.join(opf_dir, href))
            manifest_hrefs.add(full)
            if full not in names:
                errors.append(f"missing manifest href: {full}")
            props = item.attrib.get("properties", "").split()
            if "nav" in props:
                nav_count += 1
            if "cover-image" in props:
                cover_image_count += 1
        if package.attrib.get("version", "").startswith("3") and nav_count == 0:
            errors.append("EPUB 3 package has no manifest item with properties='nav'")

        spine = package.find(q(OPF, "spine"))
        if spine is None:
            errors.append("OPF missing spine")
        else:
            ids = {item.attrib.get("id") for item in manifest.findall(q(OPF, "item"))}
            for itemref in spine.findall(q(OPF, "itemref")):
                if itemref.attrib.get("idref") not in ids:
                    errors.append(f"spine references missing id: {itemref.attrib.get('idref')}")

        for name in sorted(names):
            if not name.endswith((".xhtml", ".html")):
                continue
            base = posixpath.dirname(name)
            try:
                root = ET.fromstring(zf.read(name))
            except Exception:
                continue
            for el in root.iter():
                for attr in ("href", "src"):
                    value = el.attrib.get(attr)
                    if not value or value.startswith(("#", "http://", "https://", "mailto:", "tel:", "urn:")):
                        continue
                    target = value.split("#", 1)[0]
                    if not target:
                        continue
                    resolved = posixpath.normpath(posixpath.join(base, target))
                    if resolved not in names:
                        errors.append(f"{name}: {attr}={value} resolves to missing {resolved}")
    return errors


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: validate_epub.py <book.epub>")
    errors = validate(Path(sys.argv[1]))
    if errors:
        print("\n".join(errors))
        raise SystemExit(1)
    print("OK")


if __name__ == "__main__":
    main()
