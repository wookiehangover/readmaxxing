"""Reject repairs that discard/rewrite book text or images, even if they render."""
import hashlib
import posixpath
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from html.parser import HTMLParser


class Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.body = False
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag == "body":
            self.body = True
        if tag in ("script", "style"):
            self.skip += 1

    def handle_endtag(self, tag):
        if tag == "body":
            self.body = False
        if tag in ("script", "style"):
            self.skip = max(0, self.skip - 1)

    def handle_data(self, data):
        if self.body and not self.skip:
            self.parts.append(data)


def content(path):
    with zipfile.ZipFile(path) as archive:
        if sum(info.file_size for info in archive.infolist()) > 200 * 1024 * 1024:
            raise ValueError("Uncompressed EPUB exceeds 200 MiB")
        if "META-INF/encryption.xml" in archive.namelist():
            raise ValueError("Encrypted EPUBs require manual inspection")
        container = ET.fromstring(archive.read("META-INF/container.xml"))
        package = next(node.attrib["full-path"] for node in container.iter() if node.tag.endswith("}rootfile"))
        opf = ET.fromstring(archive.read(package))
        base = posixpath.dirname(package)
        items = {node.attrib["id"]: node.attrib for node in opf.iter() if node.tag.endswith("}item")}
        text = []
        for node in opf.iter():
            if not node.tag.endswith("}itemref"):
                continue
            item = items[node.attrib["idref"]]
            parser = Text()
            parser.feed(archive.read(posixpath.normpath(posixpath.join(base, item["href"]))).decode("utf-8-sig"))
            text.extend(parser.parts)
        images = {
            hashlib.sha256(archive.read(posixpath.normpath(posixpath.join(base, item["href"])))).hexdigest()
            for item in items.values() if item.get("media-type", "").startswith("image/")
        }
        return re.sub(r"\s+", "", "".join(text)), images


original, original_images = content(sys.argv[1])
repaired, repaired_images = content(sys.argv[2])
if not original:
    raise ValueError("Image-only or unreadable source requires manual repair")
if original != repaired:
    raise ValueError("Repair changed or removed book text or reading order")
if not original_images.issubset(repaired_images):
    raise ValueError("Repair removed or changed an original image")
print("Original text, reading order, and images preserved.")
