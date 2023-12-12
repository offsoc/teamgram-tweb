import {setupCanvas, clearCanvas} from './canvas';
import {preparePoints} from './preparePoints';
import {createProjection} from './Projection';
import {drawDatasets} from './drawDatasets';
import {captureEvents} from './captureEvents';
import {
  DEFAULT_RANGE,
  MINIMAP_HEIGHT,
  MINIMAP_EAR_WIDTH,
  MINIMAP_MARGIN,
  MINIMAP_LINE_WIDTH,
  MINIMAP_MAX_ANIMATED_DATASETS,
  SIMPLIFIER_MINIMAP_FACTOR
} from './constants';
import {proxyMerge, throttleWithRaf} from './utils';
import {createElement} from './minifiers';
import {getSimplificationDelta} from './formulas';
import {LovelyChartBounds, LovelyChartBuildedColors, LovelyChartProjectionParams, LovelyChartRange, LovelyChartRange2, LovelyChartState, LovelyChartVisibilities, StatisticsGraph} from './types';

export function createMinimap(container: HTMLElement, data: StatisticsGraph, colors: LovelyChartBuildedColors, rangeCallback: (range: LovelyChartRange) => any) {
  let _element: HTMLElement;
  let _canvas: HTMLCanvasElement;
  let _context: CanvasRenderingContext2D;
  let _canvasSize: {width: number, height: number};
  let _ruler: HTMLElement;
  let _slider: HTMLElement;
  let _sliderContainer: HTMLElement;

  let _capturedOffset: number;
  let _range: LovelyChartRange = {};
  let _state: LovelyChartState;

  const _updateRulerOnRaf = throttleWithRaf(_updateRuler);

  _setupLayout();
  _updateRange(data.minimapRange || DEFAULT_RANGE);

  function update(newState: typeof _state) {
    const {begin, end} = newState;
    if(!_capturedOffset) {
      _updateRange({begin, end}, true);
    }

    if(data.datasets.length >= MINIMAP_MAX_ANIMATED_DATASETS) {
      newState = newState.static;
    }

    if(!_isStateChanged(newState)) {
      return;
    }

    _state = proxyMerge(newState, {focusOn: null});
    clearCanvas(_canvas, _context);

    _drawDatasets(_state);
  }

  function toggle(shouldShow: boolean) {
    _element.classList.toggle('lovely-chart--state-hidden', !shouldShow);

    requestAnimationFrame(() => {
      _element.classList.toggle('lovely-chart--state-transparent', !shouldShow);
    });
  }

  function _setupLayout() {
    _element = createElement();

    _element.className = 'lovely-chart--minimap';
    _element.style.height = `${MINIMAP_HEIGHT}px`;

    _setupCanvas();
    _setupRuler();

    container.appendChild(_element);

    _canvasSize = {
      width: _canvas.offsetWidth,
      height: _canvas.offsetHeight
    };
  }

  function _getSize() {
    return {
      width: container.offsetWidth - MINIMAP_MARGIN * 2,
      height: MINIMAP_HEIGHT
    };
  }

  function _setupCanvas() {
    const {canvas, context} = setupCanvas(_element, _getSize());
    canvas.classList.add('lovely-chart--minimap-canvas');

    _canvas = canvas;
    _context = context;
  }

  function _setupRuler() {
    _ruler = createElement();
    _ruler.className = 'lovely-chart--minimap-ruler';
    _ruler.innerHTML =
      '<div class="lovely-chart--minimap-mask lovely-chart--minimap-mask-first"></div>' +
      '<div class="lovely-chart--minimap-slider-container">' +
        '<div class="lovely-chart--minimap-slider">' +
          '<div class="lovely-chart--minimap-slider-handle lovely-chart--minimap-slider-handle-left"><span class="lovely-chart--minimap-slider-handle-pin"></span></div>' +
          '<div class="lovely-chart--minimap-slider-inner"></div>' +
          '<div class="lovely-chart--minimap-slider-handle lovely-chart--minimap-slider-handle-right"><span class="lovely-chart--minimap-slider-handle-pin"></span></div>' +
        '</div>' +
      '</div>' +
      '<div class="lovely-chart--minimap-mask lovely-chart--minimap-mask-last"></div>';

    _sliderContainer = _ruler.children[1] as HTMLElement;
    _slider = _sliderContainer.firstElementChild as HTMLElement;

    captureEvents(
      _slider.children[1] as HTMLElement,
      {
        onCapture: _onDragCapture,
        onDrag: _onSliderDrag,
        onRelease: _onDragRelease,
        draggingCursor: 'grabbing'
      }
    );

    captureEvents(
      _slider.children[0] as HTMLElement,
      {
        onCapture: _onDragCapture,
        onDrag: _onLeftEarDrag,
        onRelease: _onDragRelease,
        draggingCursor: 'ew-resize'
      }
    );

    captureEvents(
      _slider.children[2] as HTMLElement,
      {
        onCapture: _onDragCapture,
        onDrag: _onRightEarDrag,
        onRelease: _onDragRelease,
        draggingCursor: 'ew-resize'
      }
    );

    _element.appendChild(_ruler);
  }

  function _isStateChanged(newState: typeof _state) {
    if(!_state) {
      return true;
    }

    const {datasets} = data;

    if(datasets.some(({key}) => _state[`opacity#${key}`] !== newState[`opacity#${key}`])) {
      return true;
    }

    if(_state.yMaxMinimap !== newState.yMaxMinimap) {
      return true;
    }

    return false;
  }

  function _drawDatasets(state: typeof _state = {}) {
    const {datasets} = data;
    const range: LovelyChartRange2 = {
      from: 0,
      to: state.totalXWidth
    };
    const boundsAndParams: LovelyChartProjectionParams = {
      begin: 0,
      end: 1,
      totalXWidth: state.totalXWidth,
      yMin: state.yMinMinimap,
      yMax: state.yMaxMinimap,
      availableWidth: _canvasSize.width,
      availableHeight: _canvasSize.height,
      yPadding: 1
    };
    const visibilities: LovelyChartVisibilities = datasets.map(({key}) => _state[`opacity#${key}`]);
    const points = preparePoints(data, datasets, range, visibilities, boundsAndParams, true);
    const projection = createProjection(boundsAndParams);

    let secondaryPoints = null;
    let secondaryProjection = null;
    if(data.hasSecondYAxis) {
      const secondaryDataset = datasets.find((d) => d.hasOwnYAxis);
      const bounds: LovelyChartBounds = {yMin: state.yMinMinimapSecond, yMax: state.yMaxMinimapSecond};
      secondaryPoints = preparePoints(data, [secondaryDataset], range, visibilities, bounds)[0];
      secondaryProjection = projection.copy(bounds);
    }

    const totalPoints = points.reduce((a, p) => a + p.length, 0);
    const simplification = getSimplificationDelta(totalPoints) * SIMPLIFIER_MINIMAP_FACTOR;

    drawDatasets(
      _context, state, data,
      range, points, projection, secondaryPoints, secondaryProjection,
      MINIMAP_LINE_WIDTH, visibilities, colors, true, simplification
    );
  }

  function _onDragCapture(e: Event) {
    e.preventDefault();
    _capturedOffset = (e.target as HTMLElement).offsetLeft;
  }

  function _onDragRelease() {
    _capturedOffset = null;
  }

  function _onSliderDrag(moveEvent: Event, captureEvent: Event, {dragOffsetX}: {dragOffsetX: number}) {
    const minX1 = 0;
    const maxX1 = _canvasSize.width - _sliderContainer.offsetWidth;

    const newX1 = Math.max(minX1, Math.min(_capturedOffset + dragOffsetX - MINIMAP_EAR_WIDTH, maxX1));
    const newX2 = newX1 + _sliderContainer.offsetWidth;
    const begin = newX1 / _canvasSize.width;
    const end = newX2 / _canvasSize.width;

    _updateRange({begin, end});
  }

  function _onLeftEarDrag(moveEvent: Event, captureEvent: Event, {dragOffsetX}: {dragOffsetX: number}) {
    const minX1 = 0;
    const maxX1 = _sliderContainer.offsetLeft + _sliderContainer.offsetWidth - MINIMAP_EAR_WIDTH * 2;

    const newX1 = Math.min(maxX1, Math.max(minX1, _capturedOffset + dragOffsetX));
    const begin = newX1 / _canvasSize.width;

    _updateRange({begin});
  }

  function _onRightEarDrag(moveEvent: Event, captureEvent: Event, {dragOffsetX}: {dragOffsetX: number}) {
    const minX2 = _sliderContainer.offsetLeft + MINIMAP_EAR_WIDTH * 2;
    const maxX2 = _canvasSize.width;

    const newX2 = Math.max(minX2, Math.min(_capturedOffset + MINIMAP_EAR_WIDTH + dragOffsetX, maxX2));
    const end = newX2 / _canvasSize.width;

    _updateRange({end});
  }

  function _updateRange(range: typeof _range, isExternal?: boolean) {
    let nextRange = Object.assign({}, _range, range);

    if(_state && _state.minimapDelta && !isExternal) {
      nextRange = _adjustDiscreteRange(nextRange);
    }

    if(nextRange.begin === _range.begin && nextRange.end === _range.end) {
      return;
    }

    _range = nextRange;
    _updateRulerOnRaf();

    if(!isExternal) {
      rangeCallback(_range);
    }
  }

  function _adjustDiscreteRange(nextRange: typeof _range) {
    // TODO sometimes beginChange and endChange are different for slider drag because of pixels division
    const begin = Math.round(nextRange.begin / _state.minimapDelta) * _state.minimapDelta;
    const end = Math.round(nextRange.end / _state.minimapDelta) * _state.minimapDelta;

    return {begin, end};
  }

  function _updateRuler() {
    const {begin, end} = _range;

    const innerWidth = `${Math.max(0, end - begin) * 100}%`;
    const children = Array.from(_ruler.children) as HTMLElement[];
    children[0].style.width = `${begin * 100}%`;
    children[1].style.setProperty('--width', innerWidth);
    children[2].style.width = `${(1 - end) * 100}%`;
  }

  return {update, updateRange: _updateRange, toggle};
}
