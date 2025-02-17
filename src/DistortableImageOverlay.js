L.DistortableImageOverlay = L.ImageOverlay.extend({

  options: {
    alt: "",
    height: 200,
		crossOrigin: true,
		// todo: find ideal number to prevent distortions during RotateScale, and make it dynamic (remove hardcoding)
    edgeMinWidth: 520
  },

  initialize: function(url, options) {
    this._toolArray = L.DistortableImage.EditToolbarDefaults;
    this.edgeMinWidth = this.options.edgeMinWidth;
    this._url = url;
    this._rotation = this.options.rotation;
    L.DistortableImage._options = options;

    L.Util.setOptions(this, options);
  },

  onAdd: function(map) {
    /* Copied from L.ImageOverlay */
    this._map = map;

    if (!this._image) { this._initImage(); }
    if (!this._events) { this._initEvents(); }

    map._panes.overlayPane.appendChild(this._image);

    map.on("viewreset", this._reset, this);
    /* End copied from L.ImageOverlay */

    /* Use provided corners if available */
    if (this.options.corners) {
      this._corners = this.options.corners;
      if (map.options.zoomAnimation && L.Browser.any3d) {
        map.on("zoomanim", this._animateZoom, this);
      }

      /* This reset happens before image load; it allows
       * us to place the image on the map earlier with
       * "guessed" dimensions. */
      this._reset();
    }

    /* Have to wait for the image to load because
     * we need to access its width and height. */
    L.DomEvent.on(this._image, "load", function() {
      this._initImageDimensions();
      this._reset();
      /* Initialize default corners if not already set */
      if (!this._corners) {
        if (map.options.zoomAnimation && L.Browser.any3d) {
          map.on("zoomanim", this._animateZoom, this);
        }
      }
    }, this);

    this.fire("add");
  },

  onRemove: function(map) {
    this.fire("remove");

    L.ImageOverlay.prototype.onRemove.call(this, map);
  },

  _initImage: function() {
    L.ImageOverlay.prototype._initImage.call(this);

    L.extend(this._image, {
      alt: this.options.alt
    });
  },

  _addTool: function(tool) {
    this._toolArray.push(tool);
    L.DistortableImage.EditToolbar = LeafletToolbar.Popup.extend({
      options: {
        actions: this._toolArray
      }
    });
  },

  _initImageDimensions: function() {
    var map = this._map,
      originalImageWidth = L.DomUtil.getStyle(this._image, "width"),
      originalImageHeight = L.DomUtil.getStyle(this._image, "height"),
      aspectRatio =
        parseInt(originalImageWidth) / parseInt(originalImageHeight),
      imageHeight = this.options.height,
      imageWidth = parseInt(aspectRatio * imageHeight),
      center = map.latLngToContainerPoint(map.getCenter()),
      offset = L.point(imageWidth, imageHeight).divideBy(2);

    if (this.options.corners) {
      this._corners = this.options.corners;
    } else {
      this._corners = [
        map.containerPointToLatLng(center.subtract(offset)),
        map.containerPointToLatLng(
          center.add(L.point(offset.x, -offset.y))
        ),
        map.containerPointToLatLng(
          center.add(L.point(-offset.x, offset.y))
        ),
        map.containerPointToLatLng(center.add(offset))
      ];
    }
  },

  _initEvents: function() {
    this._events = ["click"];

    for (var i = 0, l = this._events.length; i < l; i++) {
      L.DomEvent.on(this._image, this._events[i], this._fireMouseEvent, this);
    }
  },

  /* See src/layer/vector/Path.SVG.js in the Leaflet source. */
  _fireMouseEvent: function(event) {
    if (!this.hasEventListeners(event.type)) { return; }

    var map = this._map,
      containerPoint = map.mouseEventToContainerPoint(event),
      layerPoint = map.containerPointToLayerPoint(containerPoint),
      latlng = map.layerPointToLatLng(layerPoint);

    this.fire(event.type, {
      latlng: latlng,
      layerPoint: layerPoint,
      containerPoint: containerPoint,
      originalEvent: event
    });
  },

  _updateCorner: function(corner, latlng) {
    this._corners[corner] = latlng;
    this._reset();
  },

  // fires a reset after all corner positions are updated instead of after each one (above). Use for translating
  _updateCorners: function(latlngObj) {
    var i = 0;
    for (var k in latlngObj) {
      this._corners[i] = latlngObj[k];
      i += 1;
    }

    this._reset();
  },

  _updateCornersFromPoints: function(pointsObj) {
    var map = this._map;
    var i = 0;
    for (var k in pointsObj) {
      this._corners[i] = map.layerPointToLatLng(pointsObj[k]);
      i += 1;
    }

    this._reset();
  },

  /* Copied from Leaflet v0.7 https://github.com/Leaflet/Leaflet/blob/66282f14bcb180ec87d9818d9f3c9f75afd01b30/src/dom/DomUtil.js#L189-L199 */
  /* since L.DomUtil.getTranslateString() is deprecated in Leaflet v1.0 */
  _getTranslateString: function(point) {
    // on WebKit browsers (Chrome/Safari/iOS Safari/Android) using translate3d instead of translate
    // makes animation smoother as it ensures HW accel is used. Firefox 13 doesn't care
    // (same speed either way), Opera 12 doesn't support translate3d

    var is3d = L.Browser.webkit3d,
      open = "translate" + (is3d ? "3d" : "") + "(",
      close = (is3d ? ",0" : "") + ")";

    return open + point.x + "px," + point.y + "px" + close;
  },

  _reset: function() {
    var map = this._map,
      image = this._image,
      latLngToLayerPoint = L.bind(map.latLngToLayerPoint, map),
      transformMatrix = this._calculateProjectiveTransform(latLngToLayerPoint),
      topLeft = latLngToLayerPoint(this._corners[0]),
      warp = L.DomUtil.getMatrixString(transformMatrix),
      translation = this._getTranslateString(topLeft);

    /* See L.DomUtil.setPosition. Mainly for the purposes of L.Draggable. */
    image._leaflet_pos = topLeft;

    image.style[L.DomUtil.TRANSFORM] = [translation, warp].join(" ");

    /* Set origin to the upper-left corner rather than the center of the image, which is the default. */
    image.style[L.DomUtil.TRANSFORM + "-origin"] = "0 0 0";
  },

  /*
   * Calculates the transform string that will be correct *at the end* of zooming.
   * Leaflet then generates a CSS3 animation between the current transform and
   *		 future transform which makes the transition appear smooth.
   */
  _animateZoom: function(event) {
    var map = this._map,
      image = this._image,
      latLngToNewLayerPoint = function(latlng) {
        return map._latLngToNewLayerPoint(latlng, event.zoom, event.center);
      },
      transformMatrix = this._calculateProjectiveTransform(
        latLngToNewLayerPoint
      ),
      topLeft = latLngToNewLayerPoint(this._corners[0]),
      warp = L.DomUtil.getMatrixString(transformMatrix),
      translation = this._getTranslateString(topLeft);

    /* See L.DomUtil.setPosition. Mainly for the purposes of L.Draggable. */
    image._leaflet_pos = topLeft;

    if (!L.Browser.gecko) {
      image.style[L.DomUtil.TRANSFORM] = [translation, warp].join(" ");
    }
  },

  getCorners: function() {
    return this._corners;
  },

  getCorner: function(i) {
    return this._corners[i];
  },

  /*
   * Calculates the centroid of the image.
   *		 See http://stackoverflow.com/questions/6149175/logical-question-given-corners-find-center-of-quadrilateral
   */
  getCenter: function(ll2c, c2ll) {
    var map = this._map,
      latLngToCartesian = ll2c ? ll2c : map.latLngToLayerPoint,
      cartesianToLatLng = c2ll ? c2ll : map.layerPointToLatLng,
      nw = latLngToCartesian.call(map, this._corners[0]),
      ne = latLngToCartesian.call(map, this._corners[1]),
      se = latLngToCartesian.call(map, this._corners[2]),
      sw = latLngToCartesian.call(map, this._corners[3]),
      nmid = nw.add(ne.subtract(nw).divideBy(2)),
      smid = sw.add(se.subtract(sw).divideBy(2));

    return cartesianToLatLng.call(
      map,
      nmid.add(smid.subtract(nmid).divideBy(2))
    );
  },

  // Use for translation calculations - for translation the delta for 1 corner applies to all 4
  _calcCornerPointDelta: function() {
    return this._dragStartPoints[0].subtract(this._dragPoints[0]);
  },

  _calcCenterTwoCornerPoints: function(topLeft, topRight) {
    var toolPoint = { x: "", y: "" };

    toolPoint.x = topRight.x + (topLeft.x - topRight.x) / 2;
    toolPoint.y = topRight.y + (topLeft.y - topRight.y) / 2;

    return toolPoint;
  },

  _calculateProjectiveTransform: function(latLngToCartesian) {
    /* Setting reasonable but made-up image defaults
     * allow us to place images on the map before
     * they've finished downloading. */
    var offset = latLngToCartesian(this._corners[0]),
      w = this._image.offsetWidth || 500,
      h = this._image.offsetHeight || 375,
      c = [],
      j;
    /* Convert corners to container points (i.e. cartesian coordinates). */
    for (j = 0; j < this._corners.length; j++) {
      c.push(latLngToCartesian(this._corners[j])._subtract(offset));
    }

    /*
     * This matrix describes the action of the CSS transform on each corner of the image.
     * It maps from the coordinate system centered at the upper left corner of the image
     *		 to the region bounded by the latlngs in this._corners.
     * For example:
     *		 0, 0, c[0].x, c[0].y
     *		 says that the upper-left corner of the image maps to the first latlng in this._corners.
     */
    return L.MatrixUtil.general2DProjection(
      0, 0, c[0].x, c[0].y,
      w, 0, c[1].x, c[1].y,
      0, h, c[2].x, c[2].y,
      w, h, c[3].x, c[3].y
    );
  },

  _getCmPerPixel: function() {
    var map = this._map;

    var dist = map.latLngToLayerPoint(this.getCorner(0))
      .distanceTo(map.latLngToLayerPoint(this.getCorner(1)));
    
    return (dist * 100) / this._image.width;
  }

});

L.distortableImageOverlay = function(id, options) {
	return new L.DistortableImageOverlay(id, options);
};



