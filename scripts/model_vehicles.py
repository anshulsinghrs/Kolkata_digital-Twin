"""
Blender 5.3 Script: Procedural Generation of Low-Poly Kolkata Vehicles
Vehicles:
  1. yellow_taxi      (Hindustan Ambassador)
  2. kolkata_bus      (CSTC Blue & Yellow state bus)
  3. auto_rickshaw    (Green & Yellow 3-wheeler)
  4. two_wheeler      (Motorcycle/Scooter with rider)
  5. hand_pulled_cart (Traditional Kolkata hand-rickshaw / cart with puller)
  6. goods_truck      (Classic Indian 6-wheel Tata lorry)

Outputs:
  - GLB models -> public/models/
  - FBX models -> models/
"""

import bpy
import bmesh
import math
import os

# Output directories
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLB_DIR = os.path.join(BASE_DIR, "public", "models")
FBX_DIR = os.path.join(BASE_DIR, "models")
os.makedirs(GLB_DIR, exist_ok=True)
os.makedirs(FBX_DIR, exist_ok=True)

def reset_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for block in bpy.data.meshes:
        if block.users == 0:
            bpy.data.meshes.remove(block)

def create_material(name, color_rgb, roughness=0.5, metalness=0.1):
    mat = bpy.data.materials.get(name)
    if not mat:
        mat = bpy.data.materials.new(name=name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = (*color_rgb, 1.0)
            bsdf.inputs["Roughness"].default_value = roughness
            bsdf.inputs["Metallic"].default_value = metalness
    return mat

# Materials library
MAT_TAXI_YELLOW = create_material("TaxiYellow", (0.96, 0.72, 0.02), roughness=0.35, metalness=0.2)
MAT_BUS_BLUE    = create_material("BusBlue", (0.04, 0.30, 0.58), roughness=0.45, metalness=0.15)
MAT_BUS_YELLOW  = create_material("BusYellow", (0.97, 0.75, 0.08), roughness=0.40, metalness=0.15)
MAT_AUTO_GREEN  = create_material("AutoGreen", (0.06, 0.44, 0.22), roughness=0.45, metalness=0.15)
MAT_AUTO_YELLOW = create_material("AutoYellow", (0.95, 0.76, 0.10), roughness=0.55, metalness=0.05)
MAT_TRUCK_CAB   = create_material("TruckCab", (0.83, 0.28, 0.12), roughness=0.45, metalness=0.2)
MAT_TRUCK_WOOD  = create_material("TruckWood", (0.42, 0.48, 0.38), roughness=0.85, metalness=0.05)
MAT_WOOD_DARK   = create_material("WoodDark", (0.42, 0.31, 0.20), roughness=0.90, metalness=0.0)
MAT_WHITE       = create_material("SignWhite", (0.92, 0.92, 0.90), roughness=0.3, metalness=0.1)
MAT_CHROME      = create_material("Chrome", (0.75, 0.78, 0.80), roughness=0.2, metalness=0.85)
MAT_GLASS       = create_material("TintedGlass", (0.12, 0.15, 0.18), roughness=0.15, metalness=0.5)
MAT_RUBBER      = create_material("TireRubber", (0.10, 0.10, 0.10), roughness=0.95, metalness=0.05)
MAT_SKIN_CLOTH  = create_material("RiderCloth", (0.85, 0.82, 0.78), roughness=0.85, metalness=0.0)
MAT_HELMET      = create_material("Helmet", (0.78, 0.22, 0.20), roughness=0.35, metalness=0.3)

PALETTE = {
    MAT_TAXI_YELLOW: (0.96, 0.72, 0.02, 1.0),
    MAT_BUS_BLUE:    (0.04, 0.30, 0.58, 1.0),
    MAT_BUS_YELLOW:  (0.97, 0.75, 0.08, 1.0),
    MAT_AUTO_GREEN:  (0.06, 0.44, 0.22, 1.0),
    MAT_AUTO_YELLOW: (0.95, 0.76, 0.10, 1.0),
    MAT_TRUCK_CAB:   (0.83, 0.28, 0.12, 1.0),
    MAT_TRUCK_WOOD:  (0.42, 0.48, 0.38, 1.0),
    MAT_WOOD_DARK:   (0.42, 0.31, 0.20, 1.0),
    MAT_WHITE:       (0.92, 0.92, 0.90, 1.0),
    MAT_CHROME:      (0.75, 0.78, 0.80, 1.0),
    MAT_GLASS:       (0.12, 0.15, 0.18, 1.0),
    MAT_RUBBER:      (0.10, 0.10, 0.10, 1.0),
    MAT_SKIN_CLOTH:  (0.85, 0.82, 0.78, 1.0),
    MAT_HELMET:      (0.78, 0.22, 0.20, 1.0),
}

def apply_vertex_colors(bm, materials):
    color_layer = bm.loops.layers.color.new("Color")
    mat_colors = [PALETTE.get(m, (0.5, 0.5, 0.5, 1.0)) for m in materials]
    for face in bm.faces:
        if 0 <= face.material_index < len(mat_colors):
            c = mat_colors[face.material_index]
            for loop in face.loops:
                loop[color_layer] = c

def add_box(bm, center, size, mat_index=0):
    cx, cy, cz = center
    sx, sy, sz = [s / 2 for s in size]
    verts = [
        bm.verts.new((cx - sx, cy - sy, cz - sz)),
        bm.verts.new((cx + sx, cy - sy, cz - sz)),
        bm.verts.new((cx + sx, cy + sy, cz - sz)),
        bm.verts.new((cx - sx, cy + sy, cz - sz)),
        bm.verts.new((cx - sx, cy - sy, cz + sz)),
        bm.verts.new((cx + sx, cy - sy, cz + sz)),
        bm.verts.new((cx + sx, cy + sy, cz + sz)),
        bm.verts.new((cx - sx, cy + sy, cz + sz)),
    ]
    faces = [
        bm.faces.new((verts[0], verts[1], verts[2], verts[3])),
        bm.faces.new((verts[4], verts[7], verts[6], verts[5])),
        bm.faces.new((verts[0], verts[4], verts[5], verts[1])),
        bm.faces.new((verts[2], verts[6], verts[7], verts[3])),
        bm.faces.new((verts[0], verts[3], verts[7], verts[4])),
        bm.faces.new((verts[1], verts[5], verts[6], verts[2])),
    ]
    for f in faces:
        f.material_index = mat_index
    return faces

def add_cylinder(bm, center, radius, depth, segments=8, axis='X', mat_index=0):
    # Generates a cylinder along chosen axis (X for wheels)
    cx, cy, cz = center
    verts_ring1 = []
    verts_ring2 = []
    half_d = depth / 2
    for i in range(segments):
        th = (i / segments) * 2 * math.pi
        c = math.cos(th) * radius
        s = math.sin(th) * radius
        if axis == 'X':
            v1 = bm.verts.new((cx - half_d, cy + c, cz + s))
            v2 = bm.verts.new((cx + half_d, cy + c, cz + s))
        elif axis == 'Y':
            v1 = bm.verts.new((cx + c, cy - half_d, cz + s))
            v2 = bm.verts.new((cx + c, cy + half_d, cz + s))
        else:
            v1 = bm.verts.new((cx + c, cy + s, cz - half_d))
            v2 = bm.verts.new((cx + c, cy + s, cz + half_d))
        verts_ring1.append(v1)
        verts_ring2.append(v2)
    
    # Cap 1 & 2
    f1 = bm.faces.new(verts_ring1[::-1])
    f2 = bm.faces.new(verts_ring2)
    f1.material_index = mat_index
    f2.material_index = mat_index
    # Sides
    for i in range(segments):
        j = (i + 1) % segments
        face = bm.faces.new((verts_ring1[i], verts_ring2[i], verts_ring2[j], verts_ring1[j]))
        face.material_index = mat_index

# -------------------------------------------------------------
# 1. YELLOW TAXI (Hindustan Ambassador)
# -------------------------------------------------------------
def build_yellow_taxi():
    reset_scene()
    mesh = bpy.data.meshes.new("TaxiMesh")
    obj = bpy.data.objects.new("yellow_taxi", mesh)
    bpy.context.collection.objects.link(obj)
    
    obj.data.materials.append(MAT_TAXI_YELLOW) # 0
    obj.data.materials.append(MAT_GLASS)       # 1
    obj.data.materials.append(MAT_CHROME)      # 2
    obj.data.materials.append(MAT_WHITE)       # 3
    obj.data.materials.append(MAT_RUBBER)      # 4
    
    bm = bmesh.new()
    # Chassis / Lower Body
    add_box(bm, (0, 0, 0.46), (1.70, 4.25, 0.48), mat_index=0)
    # Hood & Trunk slopes
    add_box(bm, (0, 1.25, 0.68), (1.62, 1.45, 0.28), mat_index=0)
    add_box(bm, (0, -1.35, 0.65), (1.60, 1.25, 0.26), mat_index=0)
    # Cabin Glass Block
    add_box(bm, (0, -0.08, 0.98), (1.50, 2.10, 0.58), mat_index=1)
    # Roof (Yellow)
    add_box(bm, (0, -0.08, 1.30), (1.46, 1.95, 0.12), mat_index=0)
    # Taxi Roof Sign
    add_box(bm, (0, 0.15, 1.42), (0.60, 0.25, 0.14), mat_index=3)
    # Chrome Grille & Bumpers
    add_box(bm, (0, 2.14, 0.42), (1.72, 0.10, 0.18), mat_index=2)
    add_box(bm, (0, -2.14, 0.42), (1.72, 0.10, 0.18), mat_index=2)
    # Chrome Grille on front
    add_box(bm, (0, 2.05, 0.58), (1.10, 0.08, 0.22), mat_index=2)
    # 4 Wheels
    for wx in [-0.80, 0.80]:
        for wy in [-1.22, 1.22]:
            add_cylinder(bm, (wx, wy, 0.28), radius=0.28, depth=0.22, segments=10, axis='X', mat_index=4)
            # hubcap
            add_cylinder(bm, (wx + (0.12 if wx > 0 else -0.12), wy, 0.28), radius=0.14, depth=0.04, segments=8, axis='X', mat_index=2)

    apply_vertex_colors(bm, obj.data.materials)
    bm.to_mesh(mesh)
    bm.free()
    export_model(obj, "yellow_taxi")

# -------------------------------------------------------------
# 2. KOLKATA BUS (CSTC State Bus)
# -------------------------------------------------------------
def build_kolkata_bus():
    reset_scene()
    mesh = bpy.data.meshes.new("BusMesh")
    obj = bpy.data.objects.new("kolkata_bus", mesh)
    bpy.context.collection.objects.link(obj)
    
    obj.data.materials.append(MAT_BUS_BLUE)   # 0
    obj.data.materials.append(MAT_BUS_YELLOW) # 1
    obj.data.materials.append(MAT_GLASS)      # 2
    obj.data.materials.append(MAT_WHITE)      # 3
    obj.data.materials.append(MAT_RUBBER)     # 4
    obj.data.materials.append(MAT_CHROME)     # 5
    
    bm = bmesh.new()
    # Lower Body (Royal Blue)
    add_box(bm, (0, 0, 0.95), (2.46, 9.60, 1.15), mat_index=0)
    # Continuous Window Strip
    add_box(bm, (0, 0, 1.95), (2.42, 9.45, 0.88), mat_index=2)
    # Upper Band & Roof (Canary Yellow)
    add_box(bm, (0, 0, 2.68), (2.46, 9.60, 0.62), mat_index=1)
    # Destination Board Header (Front & Rear)
    add_box(bm, (0, 4.82, 2.65), (1.60, 0.08, 0.35), mat_index=3)
    add_box(bm, (0, -4.82, 2.65), (1.20, 0.08, 0.28), mat_index=3)
    # Bumpers
    add_box(bm, (0, 4.82, 0.48), (2.48, 0.12, 0.24), mat_index=5)
    add_box(bm, (0, -4.82, 0.48), (2.48, 0.12, 0.24), mat_index=5)
    # 6 Wheels (2 front, 4 rear dual)
    for wx in [-1.15, 1.15]:
        add_cylinder(bm, (wx, 2.90, 0.45), radius=0.45, depth=0.30, segments=12, axis='X', mat_index=4)
        add_cylinder(bm, (wx, -2.10, 0.45), radius=0.45, depth=0.38, segments=12, axis='X', mat_index=4)
        add_cylinder(bm, (wx, -3.15, 0.45), radius=0.45, depth=0.38, segments=12, axis='X', mat_index=4)

    apply_vertex_colors(bm, obj.data.materials)
    bm.to_mesh(mesh)
    bm.free()
    export_model(obj, "kolkata_bus")

# -------------------------------------------------------------
# 3. AUTO-RICKSHAW (3-Wheeler)
# -------------------------------------------------------------
def build_auto_rickshaw():
    reset_scene()
    mesh = bpy.data.meshes.new("AutoMesh")
    obj = bpy.data.objects.new("auto_rickshaw", mesh)
    bpy.context.collection.objects.link(obj)
    
    obj.data.materials.append(MAT_AUTO_GREEN)  # 0
    obj.data.materials.append(MAT_AUTO_YELLOW) # 1
    obj.data.materials.append(MAT_GLASS)       # 2
    obj.data.materials.append(MAT_RUBBER)      # 3
    obj.data.materials.append(MAT_CHROME)      # 4
    
    bm = bmesh.new()
    # Floor chassis & passenger seat
    add_box(bm, (0, 0, 0.36), (1.30, 2.60, 0.24), mat_index=0)
    # Lower green panels (rear & sides)
    add_box(bm, (0, -0.45, 0.68), (1.28, 1.50, 0.44), mat_index=0)
    # Driver front nose (narrowing taper)
    add_box(bm, (0, 0.95, 0.62), (0.95, 0.85, 0.42), mat_index=0)
    # Front windscreen
    add_box(bm, (0, 0.85, 1.15), (0.90, 0.08, 0.55), mat_index=2)
    # Canopy canvas top (Yellow)
    add_box(bm, (0, -0.15, 1.55), (1.32, 2.15, 0.26), mat_index=1)
    # Canopy pillars (thin black/chrome supports)
    for px in [-0.60, 0.60]:
        for py in [-1.15, 0.85]:
            add_cylinder(bm, (px, py, 1.15), radius=0.025, depth=0.75, segments=6, axis='Z', mat_index=4)
    # 3 Wheels (1 front centered, 2 rear)
    add_cylinder(bm, (0, 1.10, 0.25), radius=0.25, depth=0.18, segments=10, axis='X', mat_index=3)
    add_cylinder(bm, (-0.60, -0.80, 0.25), radius=0.25, depth=0.18, segments=10, axis='X', mat_index=3)
    add_cylinder(bm, (0.60, -0.80, 0.25), radius=0.25, depth=0.18, segments=10, axis='X', mat_index=3)

    apply_vertex_colors(bm, obj.data.materials)
    bm.to_mesh(mesh)
    bm.free()
    export_model(obj, "auto_rickshaw")

# -------------------------------------------------------------
# 4. TWO-WHEELER (Scooter / Motorbike with Rider)
# -------------------------------------------------------------
def build_two_wheeler():
    reset_scene()
    mesh = bpy.data.meshes.new("BikeMesh")
    obj = bpy.data.objects.new("two_wheeler", mesh)
    bpy.context.collection.objects.link(obj)
    
    obj.data.materials.append(MAT_TRUCK_CAB)   # 0 - Bike body (Red/Orange)
    obj.data.materials.append(MAT_CHROME)      # 1 - Exhaust / fork
    obj.data.materials.append(MAT_RUBBER)      # 2 - Tires
    obj.data.materials.append(MAT_SKIN_CLOTH)  # 3 - Rider torso/shirt
    obj.data.materials.append(MAT_HELMET)      # 4 - Helmet
    
    bm = bmesh.new()
    # Bike frame / footboard
    add_box(bm, (0, 0, 0.38), (0.40, 1.60, 0.22), mat_index=0)
    # Front cowl & handlebars
    add_box(bm, (0, 0.62, 0.72), (0.35, 0.32, 0.48), mat_index=0)
    add_box(bm, (0, 0.62, 0.98), (0.75, 0.08, 0.08), mat_index=1)
    # Front Headlight
    add_box(bm, (0, 0.78, 0.85), (0.18, 0.06, 0.16), mat_index=1)
    # Seat
    add_box(bm, (0, -0.15, 0.65), (0.35, 0.85, 0.14), mat_index=2)
    # Two Wheels
    add_cylinder(bm, (0, 0.68, 0.26), radius=0.26, depth=0.12, segments=10, axis='X', mat_index=2)
    add_cylinder(bm, (0, -0.65, 0.26), radius=0.26, depth=0.12, segments=10, axis='X', mat_index=2)
    
    # Rider: Torso
    add_box(bm, (0, -0.05, 1.08), (0.42, 0.32, 0.58), mat_index=3)
    # Rider: Helmet/Head
    add_cylinder(bm, (0, -0.02, 1.50), radius=0.15, depth=0.26, segments=8, axis='Z', mat_index=4)
    # Rider: Arms to handlebars
    for ax in [-0.24, 0.24]:
        add_cylinder(bm, (ax, 0.30, 1.05), radius=0.06, depth=0.55, segments=6, axis='Y', mat_index=3)

    apply_vertex_colors(bm, obj.data.materials)
    bm.to_mesh(mesh)
    bm.free()
    export_model(obj, "two_wheeler")

# -------------------------------------------------------------
# 5. HAND-PULLED CART / RICKSHAW
# -------------------------------------------------------------
def build_hand_pulled_cart():
    reset_scene()
    mesh = bpy.data.meshes.new("CartMesh")
    obj = bpy.data.objects.new("hand_pulled_cart", mesh)
    bpy.context.collection.objects.link(obj)
    
    obj.data.materials.append(MAT_WOOD_DARK)  # 0 - Wood body & shafts
    obj.data.materials.append(MAT_AUTO_YELLOW)# 1 - Brass / light wood details
    obj.data.materials.append(MAT_RUBBER)     # 2 - Metal tire band
    obj.data.materials.append(MAT_SKIN_CLOTH) # 3 - Puller silhouette
    
    bm = bmesh.new()
    # Cart Axle & Frame
    add_box(bm, (0, 0, 0.65), (1.10, 1.25, 0.14), mat_index=0)
    # Passenger / Goods Basket
    add_box(bm, (0, 0.10, 0.95), (1.05, 1.15, 0.50), mat_index=0)
    # Cart Backrest / Headboard
    add_box(bm, (0, -0.45, 1.35), (1.05, 0.10, 0.45), mat_index=1)
    
    # Two Large Wooden Wheels (Diameter 1.20m)
    for wx in [-0.68, 0.68]:
        # Rim
        add_cylinder(bm, (wx, 0, 0.60), radius=0.60, depth=0.08, segments=16, axis='X', mat_index=2)
        # Hub
        add_cylinder(bm, (wx, 0, 0.60), radius=0.12, depth=0.16, segments=8, axis='X', mat_index=0)
        # Spokes (4 cross bars)
        for ang in [0, 45, 90, 135]:
            rad = math.radians(ang)
            sy = math.cos(rad) * 0.55
            sz = math.sin(rad) * 0.55
            add_cylinder(bm, (wx, 0, 0.60), radius=0.025, depth=1.10, segments=4, axis='Y' if ang%90==0 else 'Z', mat_index=0)

    # Long Pulling Shafts extending forward
    for sx in [-0.42, 0.42]:
        add_cylinder(bm, (sx, 1.45, 0.72), radius=0.035, depth=1.85, segments=6, axis='Y', mat_index=0)
    # Front Crossbar
    add_cylinder(bm, (0, 2.35, 0.72), radius=0.035, depth=0.88, segments=6, axis='X', mat_index=0)

    # Puller Silhouette: Torso, legs, head walking forward
    add_box(bm, (0, 2.25, 1.05), (0.36, 0.26, 0.50), mat_index=3) # Torso
    add_cylinder(bm, (0, 2.25, 1.42), radius=0.12, depth=0.22, segments=8, axis='Z', mat_index=3) # Head
    for lx in [-0.12, 0.12]:
        add_cylinder(bm, (lx, 2.25, 0.45), radius=0.06, depth=0.75, segments=6, axis='Z', mat_index=3) # Legs

    apply_vertex_colors(bm, obj.data.materials)
    bm.to_mesh(mesh)
    bm.free()
    export_model(obj, "hand_pulled_cart")

# -------------------------------------------------------------
# 6. GOODS TRUCK (Classic Indian Tata 6-Wheel Lorry)
# -------------------------------------------------------------
def build_goods_truck():
    reset_scene()
    mesh = bpy.data.meshes.new("TruckMesh")
    obj = bpy.data.objects.new("goods_truck", mesh)
    bpy.context.collection.objects.link(obj)
    
    obj.data.materials.append(MAT_TRUCK_CAB)   # 0 - Cabin (Orange/Red)
    obj.data.materials.append(MAT_TRUCK_WOOD)  # 1 - Slatted Cargo Bed (Green/Wood)
    obj.data.materials.append(MAT_AUTO_YELLOW) # 2 - Visor / Decorative header
    obj.data.materials.append(MAT_GLASS)       # 3 - Windscreen
    obj.data.materials.append(MAT_CHROME)      # 4 - Bumper & Grille
    obj.data.materials.append(MAT_RUBBER)      # 5 - Tires
    
    bm = bmesh.new()
    # Chassis frame
    add_box(bm, (0, 0, 0.65), (2.10, 8.20, 0.35), mat_index=4)
    # Driver Cabin (Front)
    add_box(bm, (0, 2.65, 1.65), (2.35, 2.20, 1.65), mat_index=0)
    # Windscreen
    add_box(bm, (0, 3.45, 1.85), (2.20, 0.10, 0.65), mat_index=3)
    # Front Grille & heavy steel bumper
    add_box(bm, (0, 3.76, 0.95), (2.38, 0.12, 0.55), mat_index=4)
    add_box(bm, (0, 3.82, 0.50), (2.45, 0.15, 0.28), mat_index=4)
    # Iconic Roof Crown / Visor ("Horn Please / All India Permit")
    add_box(bm, (0, 2.60, 2.65), (2.38, 0.65, 0.40), mat_index=2)
    # Wooden Cargo Bed with tall slatted headboard
    add_box(bm, (0, -1.25, 1.60), (2.40, 5.20, 1.55), mat_index=1)
    # Tall headboard behind cabin
    add_box(bm, (0, 1.35, 2.10), (2.42, 0.18, 0.85), mat_index=2)
    # 6 Large Wheels (2 front, 4 rear dual)
    for wx in [-1.15, 1.15]:
        add_cylinder(bm, (wx, 2.70, 0.52), radius=0.52, depth=0.32, segments=12, axis='X', mat_index=5)
        add_cylinder(bm, (wx, -1.85, 0.52), radius=0.52, depth=0.42, segments=12, axis='X', mat_index=5)
        add_cylinder(bm, (wx, -3.10, 0.52), radius=0.52, depth=0.42, segments=12, axis='X', mat_index=5)

    apply_vertex_colors(bm, obj.data.materials)
    bm.to_mesh(mesh)
    bm.free()
    export_model(obj, "goods_truck")

def export_model(obj, name):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    
    # 1. Export GLB (glTF Binary)
    glb_path = os.path.join(GLB_DIR, f"{name}.glb")
    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        use_selection=True,
        export_format='GLB',
        export_apply=True
    )
    print(f"Exported GLB: {glb_path} ({os.path.getsize(glb_path)} bytes)")
    
    # 2. Export FBX (Unity Ready)
    fbx_path = os.path.join(FBX_DIR, f"{name}.fbx")
    bpy.ops.export_scene.fbx(
        filepath=fbx_path,
        use_selection=True,
        apply_unit_scale=True,
        apply_scale_options='FBX_SCALE_ALL'
    )
    print(f"Exported FBX: {fbx_path} ({os.path.getsize(fbx_path)} bytes)")

if __name__ == "__main__":
    print("Generating Kolkata Low-Poly Vehicles...")
    build_yellow_taxi()
    build_kolkata_bus()
    build_auto_rickshaw()
    build_two_wheeler()
    build_hand_pulled_cart()
    build_goods_truck()
    print("All 6 vehicle models successfully built and exported!")
